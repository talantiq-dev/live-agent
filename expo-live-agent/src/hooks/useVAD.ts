import { Asset } from 'expo-asset';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Generic VAD hook for live-agent.
 * Supports loading model weights from a local asset or a remote URI.
 */

const FRAME_SIZE = 512;
const SAMPLE_RATE = 16000;
const THRESHOLD = 0.5;
const HANG_TIME_MS = 800;

interface useVADOptions {
    modelSource: number | string; // Local asset number or remote URI
    threshold?: number;
    hangTimeMs?: number;
}

export function useVAD({ modelSource, threshold = THRESHOLD, hangTimeMs = HANG_TIME_MS }: useVADOptions) {
    const sessionRef = useRef<any>(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const stateRef = useRef<Float32Array>(new Float32Array(2 * 1 * 128));
    const sampleBufferRef = useRef<Int16Array[]>([]);
    const bufferedSamplesRef = useRef<number>(0);
    const hangTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const load = async () => {
            let InferenceSession: any;
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                ({ InferenceSession } = require('onnxruntime-react-native'));
            } catch (e) {
                console.warn('[useVAD] onnxruntime-react-native not available:', e);
                return;
            }

            try {
                let modelUri: string;
                if (typeof modelSource === 'number') {
                    const asset = Asset.fromModule(modelSource);
                    await asset.downloadAsync();
                    if (!asset.localUri) throw new Error('Asset localUri is null after download');
                    modelUri = asset.localUri;
                } else {
                    modelUri = modelSource;
                }

                sessionRef.current = await InferenceSession.create(modelUri);
                console.log('[useVAD] model loaded.');
            } catch (e) {
                console.error('[useVAD] Failed to load model:', e);
            }
        };
        load();
        return () => { sessionRef.current = null; };
    }, [modelSource]);

    const reset = useCallback(() => {
        stateRef.current = new Float32Array(2 * 1 * 128);
        sampleBufferRef.current = [];
        bufferedSamplesRef.current = 0;
        if (hangTimerRef.current) clearTimeout(hangTimerRef.current);
        setIsSpeaking(false);
    }, []);

    const processFrame = useCallback(async (samples: Int16Array) => {
        const session = sessionRef.current;
        if (!session) return;

        let Tensor: any;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            ({ Tensor } = require('onnxruntime-react-native'));
        } catch {
            return;
        }

        const float32 = new Float32Array(FRAME_SIZE);
        for (let i = 0; i < FRAME_SIZE; i++) float32[i] = samples[i] / 32768.0;

        try {
            const inputTensor = new Tensor('float32', float32, [1, FRAME_SIZE]);
            const stateTensor = new Tensor('float32', stateRef.current, [2, 1, 128]);
            const srTensor = new Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), [1]);

            const results = await session.run({
                input: inputTensor,
                state: stateTensor,
                sr: srTensor,
            });

            const prob = results['output'].data[0] as number;
            stateRef.current = results['stateN'].data as Float32Array;

            if (prob > threshold) {
                setIsSpeaking(true);
                if (hangTimerRef.current) clearTimeout(hangTimerRef.current);
                hangTimerRef.current = setTimeout(() => setIsSpeaking(false), hangTimeMs);
            }
        } catch (e) {
            console.warn('[useVAD] Inference error:', e);
        }
    }, [threshold, hangTimeMs]);

    const addFrame = useCallback((base64Pcm: string) => {
        const binary = atob(base64Pcm);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer);

        sampleBufferRef.current.push(int16);
        bufferedSamplesRef.current += int16.length;

        while (bufferedSamplesRef.current >= FRAME_SIZE) {
            const merged = mergeInt16Arrays(sampleBufferRef.current);
            const frame = merged.slice(0, FRAME_SIZE);
            const remaining = merged.slice(FRAME_SIZE);
            sampleBufferRef.current = remaining.length > 0 ? [remaining] : [];
            bufferedSamplesRef.current = remaining.length;
            processFrame(frame);
        }
    }, [processFrame]);

    return { isSpeaking, addFrame, reset };
}

function mergeInt16Arrays(arrays: Int16Array[]): Int16Array {
    const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const arr of arrays) { merged.set(arr, offset); offset += arr.length; }
    return merged;
}
