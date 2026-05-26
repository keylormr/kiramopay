/**
 * Type-safe helpers built on top of the auto-generated OpenAPI types.
 *
 * Usage from an adapter:
 *
 *   import type { components } from '@/api/generated/openapi';
 *   import type { ApiData } from '@/api/generated/helpers';
 *
 *   // The shape the backend returns for GET /api/v1/wallets/me/balance:
 *   type BalanceDTO = components['schemas']['BalanceResponse'];
 *
 *   // Or, when you want to anchor to a path+method (single source of truth):
 *   type WalletGetData = ApiData<'/api/v1/wallets/me', 'get'>;
 *
 * Why this file exists:
 *   We want one place where the project documents how to *consume* the
 *   generated types. Adapters import from here rather than spelunking the
 *   3000-line generated file directly, so renames stay tidy.
 */
import type { paths, components } from './openapi';

/** Shorthand for a named schema component. */
export type Schema<K extends keyof components['schemas']> = components['schemas'][K];

/** All defined schema names — useful when you want a union of available DTOs. */
export type SchemaName = keyof components['schemas'];

/** Methods we actually call on the API. */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Extract the JSON response body for (path, method, status?). Defaults to 200.
 *
 *   type Out = ApiData<'/api/v1/wallets/me', 'get'>;
 *   // Out is the `data` field shape inside ApiResponse<T>.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiData<
  P extends keyof paths,
  M extends HttpMethod,
  S extends number = 200,
> = paths[P] extends Record<M, { responses: Record<S, { content: { 'application/json': infer R } }> }>
  ? R extends { data?: infer D }
    ? D
    : R
  : never;

/** Request body shape for a (path, method). Useful for POST/PATCH/PUT. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiBody<P extends keyof paths, M extends HttpMethod> = paths[P] extends Record<
  M,
  { requestBody?: { content: { 'application/json': infer B } } }
>
  ? B
  : never;
