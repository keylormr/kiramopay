import type { ApiResponse } from '../types';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantReply {
  reply: string;
  toolsUsed: string[];
}

/**
 * Conversational assistant repository. HTTP-only (the LLM runs behind the
 * backend; there is no mock adapter). Read-only: it answers questions about the
 * user's data and cannot move money.
 */
export interface IAssistantRepository {
  /** Whether the assistant is configured server-side (GEMINI_API_KEY present). */
  status(): Promise<ApiResponse<{ available: boolean }>>;
  /** Ask a question, optionally with prior turns for context. */
  chat(message: string, history?: AssistantTurn[]): Promise<ApiResponse<AssistantReply>>;
}
