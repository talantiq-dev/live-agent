import React, { createContext, useCallback, useContext, useRef, useState, useEffect } from 'react';
import { Modality, ClientEvent, ServerEvent, ServerContent, ClientAction } from '@live-agent/core';
import { ConversationEntry } from './types';
import { useAudioStream } from './hooks/useAudioStream';
import { getRMS } from './utils/audio';

interface LiveAgentContextValue {
    mode: Modality | 'idle';
    isAgentSpeaking: boolean;
    isUserSpeaking: boolean;
    userAudioEnergy: number;
    agentAudioEnergy: number;
    start: (params: { initialState: any, mode: Modality, agentMode?: string, timezone?: string }) => Promise<void>;
    stop: () => void;
    sendAppState: (context: any) => void;
    sendMedia: (data: string, mimeType: string) => void;
    lastAction: ClientAction | null;
    lastClientAction: ClientAction | null;
    clearAction: () => void;
    confirmAction: (actionId: string, result?: any) => void;
    conversationHistory: any[];
    clearHistory: () => void;
    groundingResults: any[];
}

const LiveAgentContext = createContext<LiveAgentContextValue | null>(null);

export interface LiveAgentConfig {
    serverUrl: string;
    authToken?: string;
}

interface LiveAgentProviderProps {
    config: LiveAgentConfig;
    children: React.ReactNode;
    /** Whether user is speaking (from external VAD) */
    isUserSpeaking?: boolean;
    /** Frame callback for external VAD */
    onAudioFrame?: (base64Pcm: string) => void;
}

export function LiveAgentProvider({ config, children, isUserSpeaking = false, onAudioFrame }: LiveAgentProviderProps) {
    const wsRef = useRef<WebSocket | null>(null);
    const [mode, setMode] = useState<Modality | 'idle'>('idle');
    const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
    const [userAudioEnergy, setUserAudioEnergy] = useState(0);
    const [agentAudioEnergy, setAgentAudioEnergy] = useState(0);
    const [lastAction, setLastAction] = useState<ClientAction | null>(null);
    const [groundingResults, setGroundingResults] = useState<any[]>([]);
    const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([]);
    const pendingAppStateRef = useRef<any>(null);

    const echoRMSFloorRef = useRef(150);
    const interruptionFramesRef = useRef(0);
    const lastActionTimeRef = useRef(0);

    // Throttling for UI updates
    const lastUserEnergyUpdateRef = useRef(0);
    const lastAgentEnergyUpdateRef = useRef(0);
    const ENERGY_THROTTLE_MS = 60;

    const throttledEnergyUpdate = (setter: (e: number) => void, lastRef: React.MutableRefObject<number>, energy: number) => {
        const now = Date.now();
        if (now - lastRef.current > ENERGY_THROTTLE_MS || energy === 0) {
            setter(energy);
            lastRef.current = now;
        }
    };

    const isUserSpeakingRef = useRef(isUserSpeaking);
    useEffect(() => { isUserSpeakingRef.current = isUserSpeaking; }, [isUserSpeaking]);

    const isAgentSpeakingRef = useRef(isAgentSpeaking);
    useEffect(() => { isAgentSpeakingRef.current = isAgentSpeaking; }, [isAgentSpeaking]);

    // We need a ref for clearPlaybackQueue because it's part of the useAudioStream return value,
    // and the onAudioChunk callback needs to access it, but onAudioChunk is defined before
    // the useAudioStream hook is called and its return values are destructured.
    const clearPlaybackQueueRef = useRef<() => void>(() => { });

    const onAudioChunk = useCallback((base64: string) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
            const rms = getRMS(base64);

            // AEC / Gate Logic
            if (isAgentSpeakingRef.current && !isUserSpeakingRef.current) {
                if (rms > 50) echoRMSFloorRef.current = (echoRMSFloorRef.current * 0.8) + (rms * 0.2);
            } else if (!isAgentSpeakingRef.current) {
                echoRMSFloorRef.current = Math.max(100, echoRMSFloorRef.current * 0.95);
            }

            const AMBIENT_THRESHOLD = 150;
            const dynamicThreshold = Math.max(AMBIENT_THRESHOLD, echoRMSFloorRef.current * 2.0);
            const currentThreshold = isAgentSpeakingRef.current ? dynamicThreshold : AMBIENT_THRESHOLD;

            const isSpeechDetected = isUserSpeakingRef.current || rms > currentThreshold;

            if (isSpeechDetected && isAgentSpeakingRef.current) {
                interruptionFramesRef.current++;
                if (interruptionFramesRef.current >= 3) {
                    clearPlaybackQueueRef.current(); // Use the ref here
                    setIsAgentSpeaking(false);
                    interruptionFramesRef.current = 0;
                }
            } else {
                interruptionFramesRef.current = 0;
            }

            ws.send(JSON.stringify({ event: 'media', data: { data: base64, mimeType: 'audio/pcm;rate=16000' } }));
            throttledEnergyUpdate(setUserAudioEnergy, lastUserEnergyUpdateRef, rms / 1000); // Normalize roughly
        }
    }, []); // No dependencies needed for clearPlaybackQueueRef.current as it's a ref

    const audioStream = useAudioStream(
        onAudioChunk,
        onAudioFrame,
        (energy: number) => throttledEnergyUpdate(setAgentAudioEnergy, lastAgentEnergyUpdateRef, energy),
        () => { } // Handled in chunk callback
    );

    const { startRecording, stopRecording, playAudioChunk, flushPlayback, clearPlaybackQueue, resetInterruption } = audioStream;

    // Update the ref once clearPlaybackQueue is available
    useEffect(() => {
        clearPlaybackQueueRef.current = clearPlaybackQueue;
    }, [clearPlaybackQueue]);

    const handleServerEvent = useCallback((event: ServerEvent) => {
        if (event.event === 'server_content') {
            const { audio, turnComplete, interrupted, groundingMetadata } = event.data;

            if (audio) {
                resetInterruption();
                playAudioChunk(audio);
                setIsAgentSpeaking(true);
            }

            if (turnComplete) {
                setIsAgentSpeaking(false);
                flushPlayback();
            }

            if (interrupted) {
                if (Date.now() - lastActionTimeRef.current > 800) {
                    clearPlaybackQueue();
                    setIsAgentSpeaking(false);
                }
            }

            if (groundingMetadata) {
                setGroundingResults(prev => [...prev, groundingMetadata]);
            }
        } else if (event.event === 'client_action') {
            setLastAction(event.data);
            const content = event.data?.payload?.text || event.data?.type || 'Tool call';
            setConversationHistory(prev => [...prev, {
                id: Math.random().toString(36).substring(7),
                role: 'assistant',
                text: content,
                timestamp: Date.now()
            }]);
        } else if (event.event === 'ping') {
            wsRef.current?.send(JSON.stringify({ event: 'pong' }));
        }
    }, [playAudioChunk, flushPlayback, clearPlaybackQueue, resetInterruption]);

    const start = useCallback(async (params: {
        initialState: any;
        mode: Modality;
        agentMode?: string;
        timezone?: string;
    }) => {
        const { initialState, mode: startMode, agentMode = 'default', timezone = 'UTC' } = params;
        if (wsRef.current) wsRef.current.close();

        const url = `${config.serverUrl}?token=${config.authToken}&mode=${startMode}&agentMode=${agentMode}&timezone=${timezone}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ event: 'app_state', data: initialState }));
            if (pendingAppStateRef.current) {
                ws.send(JSON.stringify({ event: 'app_state', data: pendingAppStateRef.current }));
                pendingAppStateRef.current = null;
            }
        };
        ws.onmessage = (e) => {
            try {
                const event = JSON.parse(e.data) as ServerEvent;
                handleServerEvent(event);
            } catch (err) {
                console.error('[LiveAgent] Parse error', err);
            }
        };
        ws.onclose = () => setMode('idle');

        setMode(startMode);
        setConversationHistory(prev => [...prev, {
            id: 'init-' + Date.now(),
            role: 'system',
            text: `Session started (${startMode} mode)`,
            timestamp: Date.now()
        }]);
        await startRecording();
    }, [config, handleServerEvent, startRecording]);

    const stop = useCallback(() => {
        wsRef.current?.close();
        wsRef.current = null;
        setMode('idle');
        setIsAgentSpeaking(false);
        stopRecording();
        clearPlaybackQueue();
    }, [stopRecording, clearPlaybackQueue]);

    const confirmAction = useCallback((actionId: string, result?: any) => {
        lastActionTimeRef.current = Date.now();
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'action_confirmation', data: { actionId, result } }));
        }
    }, []);

    const sendAppState = useCallback((ctx: any) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'app_state', data: ctx }));
        } else {
            pendingAppStateRef.current = ctx;
        }
        if (ctx.systemNotification || ctx.stepText) {
            setConversationHistory(prev => [...prev, {
                id: 'ctx-' + Date.now(),
                role: 'system',
                text: ctx.systemNotification || ctx.stepText,
                timestamp: Date.now()
            }]);
        }
    }, []);

    const sendMedia = useCallback((data: string, mimeType: string) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'media', data: { data, mimeType } }));
        }
    }, []);

    return (
        <LiveAgentContext.Provider value={{
            mode,
            isAgentSpeaking,
            isUserSpeaking,
            userAudioEnergy,
            agentAudioEnergy,
            start,
            stop,
            sendAppState,
            sendMedia,
            lastAction,
            lastClientAction: lastAction,
            clearAction: () => setLastAction(null),
            confirmAction,
            conversationHistory,
            clearHistory: () => setConversationHistory([]),
            groundingResults
        }}>
            {children}
        </LiveAgentContext.Provider>
    );
}

export function useLiveAgent() {
    const ctx = useContext(LiveAgentContext);
    if (!ctx) throw new Error('useLiveAgent must be used within a LiveAgentProvider');
    return ctx;
}
