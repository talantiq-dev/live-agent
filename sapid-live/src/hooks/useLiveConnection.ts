import { useRef, useCallback, useState } from 'react';
import { SapidLiveConfig, AppContext, AssistantMode, ServerEvent } from '../types';

/**
 * Manages the WebSocket connection to the sapid-live-agent-backend.
 * Sends media (audio/video) and app context over the socket, and
 * routes incoming server events to a caller-supplied callback.
 */
export function useLiveConnection(
    config: SapidLiveConfig,
    onEvent: (event: ServerEvent) => void,
) {
    const wsRef = useRef<WebSocket | null>(null);
    const [mode, setMode] = useState<AssistantMode>('idle');

    const connect = useCallback(
        (initialContext: AppContext) => {
            if (wsRef.current) {
                wsRef.current.close();
            }

            const ws = new WebSocket(
                `${config.serverUrl}?token=${config.authToken}`,
            );
            wsRef.current = ws;

            ws.onopen = () => {
                onEvent({ type: 'connected' });
                // Immediately send the initial app state to prime the AI session
                ws.send(
                    JSON.stringify({ event: 'app_state', data: initialContext }),
                );
            };

            ws.onmessage = (e) => {
                try {
                    const parsed = JSON.parse(e.data as string);
                    onEvent({ type: 'serverContent', data: parsed });
                } catch {
                    onEvent({ type: 'error', message: 'Failed to parse server message.' });
                }
            };

            ws.onerror = () => {
                onEvent({ type: 'error', message: 'WebSocket error.' });
            };

            ws.onclose = () => {
                onEvent({ type: 'disconnected' });
                setMode('idle');
                wsRef.current = null;
            };
        },
        [config, onEvent],
    );

    const disconnect = useCallback(() => {
        wsRef.current?.close();
    }, []);

    /**
     * Send a media chunk (audio PCM or image JPEG) to the backend.
     * The backend will route audio to the Live API and images to the Watcher.
     */
    const sendMedia = useCallback((mimeType: string, base64Data: string) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ event: 'media', data: { mimeType, data: base64Data } }));
    }, []);

    /**
     * Update the backend and AI agents with fresh app context (e.g. recipe step changed).
     */
    const sendAppState = useCallback((context: AppContext) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ event: 'app_state', data: context }));
    }, []);

    return { connect, disconnect, sendMedia, sendAppState, mode, setMode };
}
