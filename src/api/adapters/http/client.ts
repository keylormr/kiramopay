import { ApiResponse, apiError } from '../../types';

// In-memory token holders. The auth store registers a provider after login
// so the HttpClient can read the current access token without going through
// localStorage. Persisting JWTs in localStorage was the Phase 20 footgun —
// XSS could exfiltrate the whole session. Keeping them here means a refresh
// of the page logs the user out (acceptable for a fintech UX) but a script
// injection cannot read them out-of-band.
type TokenProvider = () => { accessToken: string | null; refreshToken: string | null };

let tokenProvider: TokenProvider = () => ({ accessToken: null, refreshToken: null });

/**
 * Wire the HttpClient to read tokens from a live source (e.g. zustand store).
 * Called once from the auth store during app boot.
 */
export function registerTokenProvider(p: TokenProvider): void {
  tokenProvider = p;
}

export class HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getToken(): string | null {
    return tokenProvider().accessToken;
  }

  /** No-op kept for back-compat with callers that still invoke this. */
  setTokens(_accessToken: string, _refreshToken: string): void {
    // Intentionally empty — tokens are owned by the auth store, in memory.
  }

  /** No-op kept for back-compat. */
  clearTokens(): void {
    // Intentionally empty.
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (auth) {
      const token = this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 204) {
        return { success: true } as ApiResponse<T>;
      }

      const json = await res.json();

      if (!res.ok) {
        return apiError<T>(
          json.error?.code || 'HTTP_ERROR',
          json.error?.message || `Request failed with status ${res.status}`,
        );
      }

      return {
        success: true,
        data: json.data,
      };
    } catch {
      return apiError<T>('NETWORK_ERROR', 'Network request failed. Check your connection.');
    }
  }

  async get<T>(path: string, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, undefined, auth);
  }

  async post<T>(path: string, body?: unknown, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body, auth);
  }

  async patch<T>(path: string, body?: unknown, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body, auth);
  }

  async del<T>(path: string, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, undefined, auth);
  }
}
