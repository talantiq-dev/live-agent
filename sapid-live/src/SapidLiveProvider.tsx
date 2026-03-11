import { LiveAgentProvider, useLiveAgent } from '@live-agent/expo-live-agent';
import { AppContext, SapidLiveConfig, ConversationEntry, AssistantMode } from './types';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

interface SapidLiveContextValue {
    mode: AssistantMode;
    isAgentSpeaking: boolean;
    isUserSpeaking: boolean;
    userAudioEnergy: number; // 0 to 1 range
    agentAudioEnergy: number; // 0 to 1 range
    startVoice: (context: AppContext, agentMode?: 'cooking' | 'kitchen') => void;
    startMultimodal: (context: AppContext, agentMode?: 'cooking' | 'kitchen') => Promise<void>;
    stop: () => void;
    sendAppState: (context: AppContext, isSilent?: boolean) => void;
    sendMedia: (data: string, mimeType: string) => void;
    lastClientAction: any | null;
    clearClientAction: () => void;
    wasActionHandled: (id: string) => boolean;
    markActionHandled: (id: string) => void;
    confirmAction: (actionId: string, result?: any) => void;
    conversationHistory: ConversationEntry[];
    clearHistory: () => void;
    lastDebugFrame: string | null;
    groundingResults: any[];
    clearGroundingResults: () => void;
    isSearching: boolean;
}

const SapidLiveContext = React.createContext<SapidLiveContextValue | null>(null);

interface SapidLiveProviderProps {
    config: SapidLiveConfig;
    children: React.ReactNode;
}

/**
 * Provides the Sapid Live connection state to the entire app.
 * Wrap this around your root component (e.g. in _layout.tsx).
 */
export function SapidLiveProvider({ config, children }: SapidLiveProviderProps) {
    return (
        <LiveAgentProvider config={config}>
            <SapidLiveInner>{children}</SapidLiveInner>
        </LiveAgentProvider>
    );
}

function SapidLiveInner({ children }: { children: React.ReactNode }) {
    const {
        mode,
        isAgentSpeaking,
        isUserSpeaking,
        userAudioEnergy,
        agentAudioEnergy,
        start,
        stop: baseStop,
        sendAppState: baseSendAppState,
        sendMedia: baseSendMedia,
        lastClientAction,
        confirmAction: baseConfirmAction,
        conversationHistory,
        clearHistory,
    } = useLiveAgent();

    const [lastDebugFrame, setLastDebugFrame] = useState<string | null>(null);
    const [groundingResults, setGroundingResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const handledActionIds = useRef<Set<string>>(new Set());

    const startVoice = useCallback(async (ctx: AppContext, agentMode: 'cooking' | 'kitchen' = 'kitchen') => {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await start({
            mode: 'audio',
            agentMode,
            timezone,
            initialState: ctx
        });
    }, [start]);

    const startMultimodal = useCallback(async (ctx: AppContext, agentMode: 'cooking' | 'kitchen' = 'kitchen') => {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await start({
            mode: 'multimodal',
            agentMode,
            timezone,
            initialState: ctx
        });
    }, [start]);

    const sendAppState = useCallback((ctx: AppContext, isSilent?: boolean) => {
        baseSendAppState({ ...ctx, isSilent });
    }, [baseSendAppState]);

    const confirmAction = useCallback((actionId: string, result?: any) => {
        baseConfirmAction(actionId, result);
    }, [baseConfirmAction]);

    const stop = useCallback(() => {
        baseStop();
        setGroundingResults([]);
    }, [baseStop]);

    return (
        <SapidLiveContext.Provider value={{
            mode,
            isAgentSpeaking,
            isUserSpeaking,
            userAudioEnergy,
            agentAudioEnergy,
            startVoice,
            startMultimodal,
            stop,
            sendAppState,
            sendMedia: baseSendMedia,
            lastClientAction,
            clearClientAction: () => { }, // Handled by base if needed, or kept local
            wasActionHandled: (id: string) => handledActionIds.current.has(id),
            markActionHandled: (id: string) => handledActionIds.current.add(id),
            confirmAction,
            conversationHistory,
            clearHistory,
            lastDebugFrame,
            groundingResults,
            clearGroundingResults: () => setGroundingResults([]),
            isSearching,
        }}>
            {children}
        </SapidLiveContext.Provider>
    );
}

export function useSapidLive() {
    const ctx = useContext(SapidLiveContext);
    if (!ctx) throw new Error('useSapidLive must be used within a SapidLiveProvider');
    return ctx;
}
