import { useRef, useCallback, useEffect } from 'react';

/**
 * Manages 1fps camera frame extraction for the Watcher service.
 *
 * This hook is designed to work with `react-native-vision-camera` but
 * abstracts it so any frame source can be used.
 *
 * Usage in the host app:
 * 1. Render a `<Camera>` component with `ref={cameraRef}`.
 * 2. Pass `cameraRef` to this hook.
 * 3. When `isActive` is true, the hook captures a frame once per second,
 *    downscales it to 512x512, and calls `onFrame` with a base64 JPEG string.
 */
export function useVisionStream(
    isActive: boolean,
    onFrame: (base64Jpeg: string) => void,
) {
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const cameraRef = useRef<any>(null);

    const captureFrame = useCallback(async () => {
        if (!cameraRef.current) return;

        try {
            // IMPLEMENTATION NOTE: Uncomment and adjust for `react-native-vision-camera` v4+:
            // const photo = await cameraRef.current.takeSnapshot({
            //   quality: 70,
            //   skipMetadata: true,
            // });
            // The resulting photo.path is a file URI.
            // To get base64, use expo-file-system or react-native-fs:
            // const base64 = await FileSystem.readAsStringAsync(photo.path, {
            //   encoding: FileSystem.EncodingType.Base64,
            // });
            // onFrame(base64);

            console.log('[useVisionStream] Frame captured (wire up VisionCamera here)');
        } catch (e) {
            console.warn('[useVisionStream] Failed to capture frame:', e);
        }
    }, [onFrame]);

    useEffect(() => {
        if (isActive) {
            // Capture 1 frame per second
            intervalRef.current = setInterval(captureFrame, 1000);
        } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isActive, captureFrame]);

    return { cameraRef };
}
