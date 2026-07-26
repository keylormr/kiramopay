import type {
  IAssistantRepository,
  AssistantTurn,
  AssistantReply,
  AssistantProposal,
  AssistantConversation,
  AssistantConversationSummary,
} from '../../repositories/assistant.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

interface RawConversation {
  id: string;
  title: string;
  messages?: { role: 'user' | 'assistant'; content: string }[];
  updated_at: string;
}

function mapConversation(c: RawConversation): AssistantConversation {
  return {
    id: c.id,
    title: c.title,
    messages: (c.messages || []).map((m) => ({ role: m.role, text: m.content })),
    updatedAt: c.updated_at,
  };
}

interface RawProposal {
  kind: AssistantProposal['kind'];
  summary: string;
  amount_minor: number;
  currency: string;
  phone?: string;
  description?: string;
  provider_code?: string;
  provider_name?: string;
  client_id?: string;
  period?: string;
  operator?: string;
}

function mapProposal(r: RawProposal): AssistantProposal {
  return {
    kind: r.kind,
    summary: r.summary,
    amountMinor: r.amount_minor,
    currency: r.currency,
    phone: r.phone,
    description: r.description,
    providerCode: r.provider_code,
    providerName: r.provider_name,
    clientId: r.client_id,
    period: r.period,
    operator: r.operator,
  };
}

export class HttpAssistantRepository implements IAssistantRepository {
  constructor(private client: HttpClient) {}

  async status(): Promise<ApiResponse<{ available: boolean }>> {
    const res = await this.client.get<{ available: boolean }>('/api/v1/assistant/status');
    if (!res.success || !res.data) {
      return apiSuccess({ available: false });
    }
    return apiSuccess({ available: !!res.data.available });
  }

  async chat(message: string, conversationId?: string, history: AssistantTurn[] = []): Promise<ApiResponse<AssistantReply>> {
    const res = await this.client.post<{
      reply: string;
      tools_used?: string[];
      proposals?: RawProposal[];
      conversation_id?: string;
    }>('/api/v1/assistant/chat', { message, conversation_id: conversationId, history });
    if (!res.success || !res.data) {
      // Preserve the backend error code (e.g. ASSISTANT_QUOTA, ASSISTANT_BUSY,
      // CONVERSATION_LIMIT) so the view can show the right message.
      return apiError(res.error?.code || 'ASSISTANT_FAILED', res.error?.message || 'The assistant could not answer');
    }
    return apiSuccess({
      reply: res.data.reply,
      toolsUsed: res.data.tools_used || [],
      proposals: (res.data.proposals || []).map(mapProposal),
      conversationId: res.data.conversation_id,
    });
  }

  async listConversations(): Promise<ApiResponse<AssistantConversationSummary[]>> {
    const res = await this.client.get<{ conversations?: { id: string; title: string; message_count: number; updated_at: string }[] }>(
      '/api/v1/assistant/conversations',
    );
    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'ASSISTANT_FAILED', res.error?.message || 'Failed to load conversations');
    }
    return apiSuccess(
      (res.data.conversations || []).map((c) => ({
        id: c.id,
        title: c.title,
        messageCount: c.message_count,
        updatedAt: c.updated_at,
      })),
    );
  }

  async getConversation(id: string): Promise<ApiResponse<AssistantConversation>> {
    const res = await this.client.get<RawConversation>(`/api/v1/assistant/conversations/${id}`);
    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'ASSISTANT_FAILED', res.error?.message || 'Failed to load conversation');
    }
    return apiSuccess(mapConversation(res.data));
  }

  async createConversation(): Promise<ApiResponse<AssistantConversation>> {
    const res = await this.client.post<RawConversation>('/api/v1/assistant/conversations', {});
    if (!res.success || !res.data) {
      return apiError(res.error?.code || 'ASSISTANT_FAILED', res.error?.message || 'Failed to create conversation');
    }
    return apiSuccess(mapConversation(res.data));
  }

  async deleteConversation(id: string): Promise<ApiResponse<void>> {
    const res = await this.client.del<void>(`/api/v1/assistant/conversations/${id}`);
    if (!res.success) {
      return apiError(res.error?.code || 'ASSISTANT_FAILED', res.error?.message || 'Failed to delete conversation');
    }
    return apiSuccess(undefined);
  }
}
