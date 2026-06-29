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

// Refresh-on-401 wiring. The auth store registers a handler that exchanges the
// in-memory refresh token for a fresh pair, and a failure handler that forces a
// logout when refresh is impossible. Both are optional (mock mode leaves them
// unset, so behaviour is unchanged).
type RefreshHandler = () => Promise<boolean>;
type AuthFailureHandler = () => void;

let refreshHandler: RefreshHandler | null = null;
let authFailureHandler: AuthFailureHandler | null = null;
// A single in-flight refresh shared by all concurrent 401s, so a burst of
// expired requests triggers exactly ONE refresh call (no rotation storm).
let refreshInFlight: Promise<boolean> | null = null;

export function registerRefreshHandler(h: RefreshHandler): void {
  refreshHandler = h;
}

export function registerAuthFailureHandler(h: AuthFailureHandler): void {
  authFailureHandler = h;
}

function dedupedRefresh(): Promise<boolean> {
  if (!refreshHandler) return Promise.resolve(false);
  if (!refreshInFlight) {
    refreshInFlight = refreshHandler().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
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
    isRetry = false,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
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
        // Send the HttpOnly refresh cookie so the BFF session-restore works
        // regardless of same-origin vs cross-origin deployment (backend CORS
        // sets Access-Control-Allow-Credentials: true).
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      });

      // Access token expired/revoked: try ONE silent refresh, then replay the
      // request. If refresh fails (no/empty/invalid refresh token), force a
      // logout so the UI stops pretending the user is signed in.
      if (res.status === 401 && auth && !isRetry && refreshHandler) {
        const refreshed = await dedupedRefresh();
        if (refreshed) {
          return this.request<T>(method, path, body, auth, true, extraHeaders);
        }
        if (authFailureHandler) authFailureHandler();
        return apiError<T>('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
      }

      if (res.status === 204) {
        return { success: true } as ApiResponse<T>;
      }

      // Rate limited: surface a distinct code so the UI doesn't mistake it for
      // bad credentials, and don't try to parse a possibly non-JSON body.
      if (res.status === 429) {
        return apiError<T>('RATE_LIMITED', 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.');
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

  async post<T>(
    path: string,
    body?: unknown,
    auth = true,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body, auth, false, extraHeaders);
  }

  async patch<T>(path: string, body?: unknown, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body, auth);
  }

  async del<T>(path: string, auth = true): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, undefined, auth);
  }
}
