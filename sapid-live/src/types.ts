import { Modality } from '@live-agent/core';

/**
 * Configuration for the Sapid Live connection.
 */
export interface SapidLiveConfig {
    /** WebSocket URL of the `sapid-live-agent-backend` NestJS service. */
    serverUrl: string;
    /** Auth token to pass in the connection handshake. */
    authToken: string;
}

/**
 * App context sent over the WebSocket to prime the AI session.
 * The host app should supply this whenever the context changes.
 */
export interface AppContext {
    /** Current screen the user is on. */
    currentScreen: string;
    /** Active recipe ID (if in cooking mode). */
    recipeId?: string;
    /** Active recipe name (if in cooking mode). */
    recipeName?: string;
    /** Current step number (if in cooking mode). */
    currentStep?: number;
    /** Text content of the current step. */
    stepText?: string;
    /** Active countdown timers, expressed in seconds remaining. */
    timers?: Array<{ label: string; remainingSeconds: number }>;
    /** Timers suggested by the recipe for the current step (can be used if AI doesn't know duration). */
    proposedTimers?: Array<{ label?: string; durationSeconds: number }>;
    /** User ID for Firestore lookups. */
    userId: string;
    /** Unique ID for the current conversation session (for logging). */
    sessionId?: string;
    /** If true, the backend will update its state but NOT interrupt Gemini with a turn. */
    isSilent?: boolean;
    /** A system-generated message to inform the agent of asynchronous events. */
    systemNotification?: string;
    /** Data for a newly imported recipe that is now ready for review. */
    newlyReadyRecipe?: { id: string; name: string };
    /** User's local timezone (e.g., 'Europe/Berlin'). */
    timezone?: string;
}

/**
 * A single media chunk sent over the WebSocket.
 */
export interface MediaPayload {
    /** MIME type of the data, e.g. 'audio/pcm;rate=16000' or 'image/jpeg'. */
    mimeType: string;
    /** Base64-encoded media data. */
    data: string;
}

/**
 * Possible states the live assistant can be in.
 */
export type AssistantMode = Modality | 'idle';

/**
 * Events from the server forwarded to the host app.
 */
export type ServerEvent =
    | { type: 'serverContent'; data: any }
    | { type: 'clientAction'; data: any }
    | { type: 'grounding'; results: any[] }
    | { type: 'error'; message: string }
    | { type: 'connected' }
    | { type: 'disconnected' };

/**
 * A single entry in the local conversation history.
 */
export type ConversationEntry = {
    timestamp: number;
    appState?: AppContext;
} & (
        | { type: 'user_text'; text: string }
        | { type: 'model_text'; text: string }
        | { type: 'tool_call'; name: string; args: any; actionId?: string }
        | { type: 'tool_result'; actionId: string; result: any }
    );

/**
 * Input format for adding a history entry (omits computed fields).
 */
export type ConversationEntryInput =
    | { type: 'user_text'; text: string }
    | { type: 'model_text'; text: string }
    | { type: 'tool_call'; name: string; args: any; actionId?: string }
    | { type: 'tool_result'; actionId: string; result: any };
