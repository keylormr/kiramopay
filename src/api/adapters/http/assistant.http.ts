import type {
  IAssistantRepository,
  AssistantTurn,
  AssistantReply,
  AssistantProposal,
} from '../../repositories/assistant.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

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

  async chat(message: string, history: AssistantTurn[] = []): Promise<ApiResponse<AssistantReply>> {
    const res = await this.client.post<{
      reply: string;
      tools_used?: string[];
      proposals?: RawProposal[];
    }>('/api/v1/assistant/chat', { message, history });
    if (!res.success || !res.data) {
      return apiError('ASSISTANT_FAILED', res.error?.message || 'The assistant could not answer');
    }
    return apiSuccess({
      reply: res.data.reply,
      toolsUsed: res.data.tools_used || [],
      proposals: (res.data.proposals || []).map(mapProposal),
    });
  }
}
