import { useRef, useState, useCallback, useEffect } from 'react';
import {
    initialize,
    playPCMData,
    stopPlayback,
    useExpoTwoWayAudioEventListener,
    toggleRecording,
    useMicrophonePermissions,
    type MicrophoneDataCallback,
} from '@speechmatics/expo-two-way-audio';
import { base64ToBytes, bytesToBase64 } from '../utils/audio';

export type AudioStreamState = 'idle' | 'recording' | 'playing';

// Constants for Audio configuration
const CHUNK_ACCUMULATION_THRESHOLD = 12; // Higher threshold for more stable initial playback

/**
 * Manages microphone capture (PCM audio) and playback of audio received from the agent.
 */
export function useAudioStream(
    onAudioChunk: (base64Pcm: string) => void,
    onFrame?: (base64Pcm: string) => void,
    onPlaybackEnergy?: (energy: number) => void,
    onInputEnergy?: (energy: number) => void,
) {
    const [state, setState] = useState<AudioStreamState>('idle');
    const [micPermission, requestMicPermission] = useMicrophonePermissions();
    const playbackQueueRef = useRef<string[]>([]);
    const isInterruptedRef = useRef(false);

    // Adaptive Jitter Buffer State
    const [minBatchSize, setMinBatchSize] = useState(CHUNK_ACCUMULATION_THRESHOLD / 2);
    const consecutiveSteadyChunksRef = useRef(0);
    const lastChunkTimeRef = useRef(0);
    const minBatchSizeRef = useRef(minBatchSize);

    useEffect(() => {
        minBatchSizeRef.current = minBatchSize;
    }, [minBatchSize]);

    // Keep callback refs
    const onFrameRef = useRef(onFrame);
    const onAudioChunkRef = useRef(onAudioChunk);
    const onPlaybackEnergyRef = useRef(onPlaybackEnergy);
    const onInputEnergyRef = useRef(onInputEnergy);

    useEffect(() => {
        onFrameRef.current = onFrame;
        onAudioChunkRef.current = onAudioChunk;
        onPlaybackEnergyRef.current = onPlaybackEnergy;
        onInputEnergyRef.current = onInputEnergy;
    }, [onFrame, onAudioChunk, onPlaybackEnergy, onInputEnergy]);

    useEffect(() => {
        const initNativeAudio = async () => {
            try {
                await initialize();
            } catch (err) {
                console.error('[useAudioStream] Failed to initialize native audio engine:', err);
            }
        };
        initNativeAudio();
    }, []);

    const captureQueueRef = useRef<string[]>([]);
    const sendBatchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useExpoTwoWayAudioEventListener('onMicrophoneData', useCallback<MicrophoneDataCallback>((event) => {
        if (!event || !event.data) return;
        const arrayBuffer = event.data.buffer || event.data;
        const base64Pcm = bytesToBase64(new Uint8Array(arrayBuffer));

        captureQueueRef.current.push(base64Pcm);
        onFrameRef.current?.(base64Pcm);
    }, []));

    useExpoTwoWayAudioEventListener('onInputVolumeLevelData', useCallback((event: any) => {
        if (typeof event.data === 'number') {
            onInputEnergyRef.current?.(event.data * 2.0);
        }
    }, []));

    useExpoTwoWayAudioEventListener('onOutputVolumeLevelData', useCallback((event: any) => {
        if (typeof event.data === 'number') {
            onPlaybackEnergyRef.current?.(event.data * 1.5);
        }
    }, []));

    const playAudioChunk = useCallback(async (base64Pcm: string) => {
        if (isInterruptedRef.current) return;

        const now = Date.now();
        if (lastChunkTimeRef.current > 0) {
            const delta = now - lastChunkTimeRef.current;
            const isSteady = delta > 40 && delta < 100;

            if (isSteady) {
                consecutiveSteadyChunksRef.current++;
                if (consecutiveSteadyChunksRef.current >= 20 && minBatchSizeRef.current > 2) {
                    setMinBatchSize(prev => prev - 1);
                    consecutiveSteadyChunksRef.current = 0;
                }
            } else if (delta > 250) {
                setMinBatchSize(6);
                consecutiveSteadyChunksRef.current = 0;
            }
        }
        lastChunkTimeRef.current = now;

        playbackQueueRef.current.push(base64Pcm);

        if (playbackQueueRef.current.length >= minBatchSizeRef.current) {
            const chunksToPlay = [...playbackQueueRef.current];
            playbackQueueRef.current = [];

            const pcmBytesList = chunksToPlay.map(base64ToBytes);
            const totalLength = pcmBytesList.reduce((acc, bytes) => acc + bytes.length, 0);
            const merged = new Uint8Array(totalLength);
            let offset = 0;
            for (const bytes of pcmBytesList) {
                merged.set(bytes, offset);
                offset += bytes.length;
            }

            try {
                playPCMData(merged);
            } catch (e) {
                console.error('[useAudioStream] playPCMData failed:', e);
            }
        }
    }, []);

    const flushPlayback = useCallback(() => {
        isInterruptedRef.current = false;
        lastChunkTimeRef.current = 0;
        consecutiveSteadyChunksRef.current = 0;

        if (playbackQueueRef.current.length > 0) {
            const chunksToPlay = [...playbackQueueRef.current];
            playbackQueueRef.current = [];

            const pcmBytesList = chunksToPlay.map(base64ToBytes);
            const totalLength = pcmBytesList.reduce((acc, bytes) => acc + bytes.length, 0);
            const merged = new Uint8Array(totalLength);
            let offset = 0;
            for (const bytes of pcmBytesList) {
                merged.set(bytes, offset);
                offset += bytes.length;
            }

            playPCMData(merged);
            onPlaybackEnergyRef.current?.(0);
        }
    }, []);

    const clearPlaybackQueue = useCallback(() => {
        isInterruptedRef.current = true;
        playbackQueueRef.current = [];
        stopPlayback();
        onPlaybackEnergyRef.current?.(0);
        lastChunkTimeRef.current = 0;
        consecutiveSteadyChunksRef.current = 0;
    }, []);

    const resetInterruption = useCallback(() => {
        isInterruptedRef.current = false;
    }, []);

    const startRecording = useCallback(async () => {
        try {
            if (!micPermission?.granted) {
                const result = await requestMicPermission();
                if (!result?.granted) return;
            }

            toggleRecording(true);

            sendBatchIntervalRef.current = setInterval(() => {
                if (captureQueueRef.current.length > 0) {
                    const pcmBytesList = captureQueueRef.current.map(base64ToBytes);
                    const totalLength = pcmBytesList.reduce((acc, bytes) => acc + bytes.length, 0);
                    const merged = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const bytes of pcmBytesList) {
                        merged.set(bytes, offset);
                        offset += bytes.length;
                    }
                    captureQueueRef.current = [];
                    onAudioChunkRef.current(bytesToBase64(merged));
                }
            }, 60);

            setState('recording');
        } catch (error) {
            console.error('[useAudioStream] Failed to start recording:', error);
        }
    }, [micPermission?.granted, requestMicPermission]);

    const stopRecording = useCallback(() => {
        if (sendBatchIntervalRef.current) {
            clearInterval(sendBatchIntervalRef.current);
            sendBatchIntervalRef.current = null;
        }

        toggleRecording(false);
        setState('idle');
        playbackQueueRef.current = [];
        captureQueueRef.current = [];
        isInterruptedRef.current = false;
    }, []);

    return { state, startRecording, stopRecording, playAudioChunk, flushPlayback, clearPlaybackQueue, resetInterruption };
}
