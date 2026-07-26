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
  /** Thread this turn was saved to (server may create one on the first message). */
  conversationId?: string;
}

/** Lightweight list entry for a saved conversation (no message bodies). */
export interface AssistantConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

/** A full saved conversation with its messages. */
export interface AssistantConversation {
  id: string;
  title: string;
  messages: AssistantTurn[];
  updatedAt: string;
}

/**
 * Conversational assistant repository. HTTP-only (the LLM runs behind the
 * backend; there is no mock adapter). Read-only: it answers questions about the
 * user's data and cannot move money.
 */
export interface IAssistantRepository {
  /** Whether the assistant is configured server-side (an API key is present). */
  status(): Promise<ApiResponse<{ available: boolean }>>;
  /**
   * Ask a question. When conversationId is set the turn is saved to that thread
   * and its stored messages are the context; when omitted the server creates a
   * new thread (subject to the per-plan limit) and returns its id.
   */
  chat(message: string, conversationId?: string, history?: AssistantTurn[]): Promise<ApiResponse<AssistantReply>>;
  /** List the user's saved conversations, most recent first. */
  listConversations(): Promise<ApiResponse<AssistantConversationSummary[]>>;
  /** Fetch one saved conversation with its messages. */
  getConversation(id: string): Promise<ApiResponse<AssistantConversation>>;
  /** Create a new empty conversation (fails with CONVERSATION_LIMIT at the max). */
  createConversation(): Promise<ApiResponse<AssistantConversation>>;
  /** Delete a saved conversation. */
  deleteConversation(id: string): Promise<ApiResponse<void>>;
}
