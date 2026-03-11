import { Modality } from '@live-agent/core';

export type AssistantMode = Modality | 'idle';

export interface ConversationEntry {
    id: string;
    role: 'user' | 'assistant' | 'system';
    text?: string;
    timestamp: number;
}
