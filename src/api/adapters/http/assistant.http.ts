import type {
  IAssistantRepository,
  AssistantTurn,
  AssistantReply,
} from '../../repositories/assistant.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

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
    const res = await this.client.post<{ reply: string; tools_used?: string[] }>(
      '/api/v1/assistant/chat',
      { message, history },
    );
    if (!res.success || !res.data) {
      return apiError('ASSISTANT_FAILED', res.error?.message || 'The assistant could not answer');
    }
    return apiSuccess({ reply: res.data.reply, toolsUsed: res.data.tools_used || [] });
  }
}
