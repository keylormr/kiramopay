import type { ApiResponse } from '../types';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * A money-moving action the assistant PREPARED (Phase 3b). It is NOT executed —
 * the UI renders a confirmation card and only the user's explicit confirm calls
 * the real, fully-gated endpoint.
 */
export interface AssistantProposal {
  kind: 'sinpe_transfer' | 'bill_payment' | 'recharge';
  summary: string;
  amountMinor: number;
  currency: string;
  phone?: string;
  description?: string;
  providerCode?: string;
  providerName?: string;
  clientId?: string;
  period?: string;
  operator?: string;
}

export interface AssistantReply {
  reply: string;
  toolsUsed: string[];
  proposals: AssistantProposal[];
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
