/**
 * Shared protocol types for the Live Agent WebSocket communication.
 */

export type Modality = 'audio' | 'video' | 'multimodal';

export interface MediaChunk {
    data: string; // base64
    mimeType: string;
}

// --- Client -> Server Events ---

export type ClientEvent =
    | { event: 'app_state'; data: any }
    | { event: 'media'; data: MediaChunk }
    | { event: 'action_confirmation'; data: { actionId: string; result?: any } }
    | { event: 'pong' };

// --- Server -> Client Events ---

export interface ServerContent {
    /** Text part of the response */
    text?: string;
    /** Audio PCM data (base64) */
    audio?: string;
    /** Whether this chunk indicates the turn is complete */
    turnComplete?: boolean;
    /** Whether the agent was interrupted by the user */
    interrupted?: boolean;
    /** Metadata for Google Search grounding etc. */
    groundingMetadata?: any;
}

export interface ClientAction {
    type: string;
    payload?: any;
    actionId: string;
}

export type ServerEvent =
    | { event: 'server_content'; data: ServerContent }
    | { event: 'client_action'; data: ClientAction }
    | { event: 'ping' }
    | { event: 'debug_echo'; data: { data: string; type: 'image' | 'audio' } };

// --- Agent Interface ---

export interface AgentBridge {
    /** Start a new session with the underlying LLM */
    start(config: { systemInstruction: string; tools: any[]; modality: Modality }): Promise<void>;
    /** Send user input (audio/image) to the LLM */
    sendMedia(chunk: MediaChunk): Promise<void>;
    /** Send system/tool results to the LLM */
    sendContext(context: string): Promise<void>;
    /** Close the LLM session */
    stop(): Promise<void>;
    /** Callbacks for LLM events */
    onServerContent: (content: ServerContent) => void;
    onClientAction: (action: ClientAction) => void;
    onError: (error: any) => void;
}
