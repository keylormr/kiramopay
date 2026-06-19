import type { ApiResponse } from '../types';

/** A merchant API key (the secret itself is only ever returned once). */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string; // comma-separated allowlist
  status: string; // active | revoked
  lastUsedAt?: string;
  createdAt: string;
}

/** Result of creating a key — `full` is shown exactly once. */
export interface CreateApiKeyResult {
  key: ApiKey;
  full: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string; // comma-separated or "*"
  status: string; // active | disabled
  createdAt: string;
}

/** Result of registering a webhook — `secret` is shown exactly once. */
export interface CreateWebhookResult {
  endpoint: WebhookEndpoint;
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: string; // pending | delivered | failed
  attempts: number;
  responseCode?: number;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
}

/** The scopes a key can be granted. */
export const B2B_SCOPES = [
  'escrow:read',
  'escrow:write',
  'payout:read',
  'payout:write',
] as const;
export type B2BScope = (typeof B2B_SCOPES)[number];

/**
 * B2B repository — merchant API platform: API keys + signed webhooks. Like
 * auth/mfa this ALWAYS talks to the real backend (the secrets are sensitive);
 * there is no mock adapter.
 */
export interface IB2BRepository {
  /** List the merchant's API keys (hashed; the full key is never re-shown). */
  listKeys(): Promise<ApiResponse<ApiKey[]>>;
  /** Create a key. Empty scopes grants all. Returns the full key ONCE. */
  createKey(name: string, scopes?: string): Promise<ApiResponse<CreateApiKeyResult>>;
  /** Revoke a key. */
  revokeKey(id: string): Promise<ApiResponse<void>>;
  /** List the merchant's webhook endpoints. */
  listWebhooks(): Promise<ApiResponse<WebhookEndpoint[]>>;
  /** Register a webhook. events is comma-separated (empty/"*" = all). Returns the secret ONCE. */
  createWebhook(url: string, events: string): Promise<ApiResponse<CreateWebhookResult>>;
  /** Delete a webhook endpoint. */
  deleteWebhook(id: string): Promise<ApiResponse<void>>;
  /** Recent delivery attempts for an endpoint. */
  listDeliveries(endpointId: string, limit?: number): Promise<ApiResponse<WebhookDelivery[]>>;
}
