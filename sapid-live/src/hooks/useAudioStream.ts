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
import { Buffer } from 'buffer';
import { getRMS } from '../utils/audio';


export type AudioStreamState = 'idle' | 'recording' | 'playing';

// Constants for Audio configuration
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live default output
const CHUNK_ACCUMULATION_THRESHOLD = 12; // Higher threshold for more stable initial playback
const MIN_BATCH_SIZE = 6; // Min chunks for sequential batches to prevent stuttering

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
    const [minBatchSize, setMinBatchSize] = useState(CHUNK_ACCUMULATION_THRESHOLD / 2); // Start conservative (6)
    const consecutiveSteadyChunksRef = useRef(0);
    const lastChunkTimeRef = useRef(0);
    const minBatchSizeRef = useRef(minBatchSize);

    useEffect(() => {
        minBatchSizeRef.current = minBatchSize;
    }, [minBatchSize]);

    // Keep callback refs to avoid recreating native listeners on every render
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
        // Initialize the native PCM audio engine once on mount
        const initNativeAudio = async () => {
            try {
                await initialize();
            } catch (err) {
                console.error('[useAudioStream] Failed to initialize native audio engine:', err);
            }
        };
        initNativeAudio();
    }, []);

    // Push base64 PCM capture chunks into a buffer to compute RMS/VAD optionally, and send to the server.
    const captureQueueRef = useRef<string[]>([]);
    const sendBatchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useExpoTwoWayAudioEventListener('onMicrophoneData', useCallback<MicrophoneDataCallback>((event) => {
        // The event data from Expo Two Way Audio module is a Uint8Array,
        // As per the example repo: sendAudio(event.data.buffer) or playPCMData(event.data)
        if (!event || !event.data) return;

        // Convert the underlying ArrayBuffer or Uint8Array into a base64 string for our Gemini backend
        const arrayBuffer = (event.data as any).buffer || event.data;
        const base64Pcm = Buffer.from(new Uint8Array(arrayBuffer)).toString('base64');

        captureQueueRef.current.push(base64Pcm);
        onFrameRef.current?.(base64Pcm);
    }, []));

    useExpoTwoWayAudioEventListener('onInputVolumeLevelData', useCallback((event: any) => {
        if (typeof event.data === 'number') {
            onInputEnergyRef.current?.(event.data * 2.0); // Boost input visualizer slightly
        }
    }, []));

    useExpoTwoWayAudioEventListener('onOutputVolumeLevelData', useCallback((event: any) => {
        if (typeof event.data === 'number') {
            onPlaybackEnergyRef.current?.(event.data * 1.5); // Boost output visualizer slightly
        }
    }, []));

    const playAudioChunk = useCallback(async (base64Pcm: string) => {
        // If we are currently interrupted by the user, forcefully drop all incoming audio 
        // until the server explicitly signals turnComplete (which resets this flag).
        if (isInterruptedRef.current) return;

        // --- Adaptive Jitter Buffer Logic ---
        const now = Date.now();
        if (lastChunkTimeRef.current > 0) {
            const delta = now - lastChunkTimeRef.current;
            // A chunk is ~60ms. If it arrives within 40-100ms, it's steady.
            const isSteady = delta > 40 && delta < 100;

            if (isSteady) {
                consecutiveSteadyChunksRef.current++;
                // If we have 20 steady chunks (~1.2s), try reducing the buffer for lower latency
                if (consecutiveSteadyChunksRef.current >= 20 && minBatchSizeRef.current > 2) {
                    console.log(`[useAudioStream] Link stable, reducing buffer to ${minBatchSizeRef.current - 1}`);
                    setMinBatchSize(prev => prev - 1);
                    consecutiveSteadyChunksRef.current = 0;
                }
            } else if (delta > 250) {
                // Network gap detected! Reset to safe buffer immediately to prevent stutter
                console.warn(`[useAudioStream] Jitter detected (${delta}ms), resetting buffer to safe default`);
                setMinBatchSize(6);
                consecutiveSteadyChunksRef.current = 0;
            }
        }
        lastChunkTimeRef.current = now;

        playbackQueueRef.current.push(base64Pcm);

        // Use the dynamic minBatchSizeRef for evaluation
        if (playbackQueueRef.current.length >= minBatchSizeRef.current) {
            const chunksToPlay = [...playbackQueueRef.current];
            playbackQueueRef.current = [];

            // Decode base64 to flat bytes
            const pcmBytesList = chunksToPlay.map(base64ToBytes);
            const totalLength = pcmBytesList.reduce((acc, bytes) => acc + bytes.length, 0);
            const merged = new Uint8Array(totalLength);
            let offset = 0;
            for (const bytes of pcmBytesList) {
                merged.set(bytes, offset);
                offset += bytes.length;
            }

            // Feed raw Uint8Array PCM directly to the native audio hardware (defaulting to 24kHz)
            try {
                playPCMData(merged);
            } catch (e) {
                console.error('[useAudioStream] playPCMData failed:', e);
            }
        }
    }, []);

    const flushPlayback = useCallback(() => {
        console.log('[useAudioStream] Flushing playback queue');

        // A backend turn completion implies we can lock back onto the stream for new audio
        isInterruptedRef.current = false;

        // --- Jitter Reset ---
        // Reset timing on turn boundary to avoid false jitter warnings from silence
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
        console.log('[useAudioStream] CLEARING playback queue (Interrupting Agent)');
        isInterruptedRef.current = true;
        playbackQueueRef.current = [];
        stopPlayback();
        onPlaybackEnergyRef.current?.(0);

        // --- Jitter Reset ---
        lastChunkTimeRef.current = 0;
        consecutiveSteadyChunksRef.current = 0;
    }, []);

    const resetInterruption = useCallback(() => {
        isInterruptedRef.current = false;
    }, []);

    /**
     * Start recording microphone audio.
     */
    const startRecording = useCallback(async () => {
        console.log('[useAudioStream] Starting real-time PCM capture');

        try {
            if (!micPermission?.granted) {
                const result = await requestMicPermission();
                if (!result?.granted) {
                    console.error('[useAudioStream] Audio recording permission denied');
                    return;
                }
            }

            // Unmute the native plugin microphone
            toggleRecording(true);

            sendBatchIntervalRef.current = setInterval(() => {
                if (captureQueueRef.current.length > 0) {
                    // Recompress from base64 to single large byte buffer before shipping
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

    /**
     * Stop recording.
     */
    const stopRecording = useCallback(() => {
        console.log('[useAudioStream] Stopping PCM capture');
        if (sendBatchIntervalRef.current) {
            clearInterval(sendBatchIntervalRef.current);
            sendBatchIntervalRef.current = null;
        }

        // Mute the native plugin
        toggleRecording(false);
        setState('idle');

        // Clear buffers
        playbackQueueRef.current = [];
        captureQueueRef.current = [];
        isInterruptedRef.current = false;
    }, []);

    return { state, startRecording, stopRecording, playAudioChunk, flushPlayback, clearPlaybackQueue, resetInterruption };
}

const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64tab = new Uint8Array(256);
for (let i = 0; i < b64chars.length; i++) {
    b64tab[b64chars.charCodeAt(i)] = i;
}

function base64ToBytes(base64: string): Uint8Array {
    let len = base64.length;
    if (base64[len - 1] === '=') len--;
    if (base64[len - 1] === '=') len--;

    const out = new Uint8Array((len * 3) / 4);
    let outIdx = 0;

    for (let i = 0; i < base64.length; i += 4) {
        const c1 = b64tab[base64.charCodeAt(i)];
        const c2 = b64tab[base64.charCodeAt(i + 1)];
        const c3 = b64tab[base64.charCodeAt(i + 2)];
        const c4 = b64tab[base64.charCodeAt(i + 3)];

        out[outIdx++] = (c1 << 2) | (c2 >> 4);
        if (base64[i + 2] !== '=') {
            out[outIdx++] = ((c2 & 15) << 4) | (c3 >> 2);
        }
        if (base64[i + 3] !== '=') {
            out[outIdx++] = ((c3 & 3) << 6) | c4;
        }
    }
    return out;
}

function bytesToBase64(bytes: Uint8Array): string {
    let out = '';
    const len = bytes.length;
    for (let i = 0; i < len; i += 3) {
        out += b64chars[bytes[i] >> 2];
        out += b64chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
        out += (i + 1 < len) ? b64chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)] : '=';
        out += (i + 2 < len) ? b64chars[bytes[i + 2] & 63] : '=';
    }
    return out;
}
