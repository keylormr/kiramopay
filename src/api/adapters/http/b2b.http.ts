import type {
  IB2BRepository,
  ApiKey,
  CreateApiKeyResult,
  WebhookEndpoint,
  CreateWebhookResult,
  WebhookDelivery,
} from '../../repositories/b2b.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

interface RawKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  status: string;
  last_used_at?: string;
  created_at: string;
}

function mapKey(r: RawKey): ApiKey {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    status: r.status,
    lastUsedAt: r.last_used_at || undefined,
    createdAt: r.created_at,
  };
}

interface RawEndpoint {
  id: string;
  url: string;
  events: string;
  status: string;
  created_at: string;
}

function mapEndpoint(r: RawEndpoint): WebhookEndpoint {
  return {
    id: r.id,
    url: r.url,
    events: r.events,
    status: r.status,
    createdAt: r.created_at,
  };
}

interface RawDelivery {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  response_code?: number;
  last_error?: string;
  created_at: string;
  delivered_at?: string;
}

function mapDelivery(r: RawDelivery): WebhookDelivery {
  return {
    id: r.id,
    eventType: r.event_type,
    status: r.status,
    attempts: r.attempts,
    responseCode: r.response_code ?? undefined,
    lastError: r.last_error || undefined,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at || undefined,
  };
}

export class HttpB2BRepository implements IB2BRepository {
  constructor(private client: HttpClient) {}

  async listKeys(): Promise<ApiResponse<ApiKey[]>> {
    const res = await this.client.get<RawKey[]>('/api/v1/b2b/keys');
    if (!res.success || !res.data) {
      return apiError('B2B_KEYS_FAILED', res.error?.message || 'Could not load API keys');
    }
    return apiSuccess(res.data.map(mapKey));
  }

  async createKey(name: string, scopes = ''): Promise<ApiResponse<CreateApiKeyResult>> {
    const res = await this.client.post<{ key: RawKey; full: string }>('/api/v1/b2b/keys', {
      name,
      scopes,
    });
    if (!res.success || !res.data) {
      return apiError('B2B_KEY_CREATE_FAILED', res.error?.message || 'Could not create API key');
    }
    return apiSuccess({ key: mapKey(res.data.key), full: res.data.full });
  }

  async revokeKey(id: string): Promise<ApiResponse<void>> {
    const res = await this.client.del<{ status: string }>(`/api/v1/b2b/keys/${id}`);
    if (!res.success) {
      return apiError('B2B_KEY_REVOKE_FAILED', res.error?.message || 'Could not revoke API key');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async listWebhooks(): Promise<ApiResponse<WebhookEndpoint[]>> {
    const res = await this.client.get<RawEndpoint[]>('/api/v1/b2b/webhooks');
    if (!res.success || !res.data) {
      return apiError('B2B_WEBHOOKS_FAILED', res.error?.message || 'Could not load webhooks');
    }
    return apiSuccess(res.data.map(mapEndpoint));
  }

  async createWebhook(url: string, events: string): Promise<ApiResponse<CreateWebhookResult>> {
    const res = await this.client.post<{ endpoint: RawEndpoint; secret: string }>(
      '/api/v1/b2b/webhooks',
      { url, events },
    );
    if (!res.success || !res.data) {
      return apiError('B2B_WEBHOOK_CREATE_FAILED', res.error?.message || 'Could not register webhook');
    }
    return apiSuccess({ endpoint: mapEndpoint(res.data.endpoint), secret: res.data.secret });
  }

  async deleteWebhook(id: string): Promise<ApiResponse<void>> {
    const res = await this.client.del<{ status: string }>(`/api/v1/b2b/webhooks/${id}`);
    if (!res.success) {
      return apiError('B2B_WEBHOOK_DELETE_FAILED', res.error?.message || 'Could not delete webhook');
    }
    return apiSuccess(undefined as unknown as void);
  }

  async listDeliveries(endpointId: string, limit = 20): Promise<ApiResponse<WebhookDelivery[]>> {
    const res = await this.client.get<RawDelivery[]>(
      `/api/v1/b2b/webhooks/${endpointId}/deliveries?limit=${limit}`,
    );
    if (!res.success || !res.data) {
      return apiError('B2B_DELIVERIES_FAILED', res.error?.message || 'Could not load deliveries');
    }
    return apiSuccess(res.data.map(mapDelivery));
  }
}
