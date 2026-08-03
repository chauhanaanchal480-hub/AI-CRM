import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

// In-memory access token. The refresh token lives in an httpOnly cookie set
// by the server, so it is never touched by JS.
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let stepUpHandler: (() => Promise<void>) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}
export function setStepUpHandler(fn: (() => Promise<void>) | null) {
  stepUpHandler = fn;
}

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// ── Transparent refresh on 401 ────────────────────────────────
let refreshing: Promise<string | null> | null = null;
let steppingUp: Promise<void> | null = null;

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _stepUpRetry?: boolean;
}

function requiresStepUp(error: AxiosError) {
  const details = (error.response?.data as { error?: { details?: { code?: string } } } | undefined)?.error?.details;
  return error.response?.status === 403 && details?.code === 'STEP_UP_REQUIRED';
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await axios.post(
      `${BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    const token = res.data?.data?.accessToken as string | undefined;
    accessToken = token ?? null;
    return accessToken;
  } catch {
    accessToken = null;
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as RetryableRequestConfig;
    const isAuthCall = original?.url?.includes('/auth/');

    if (requiresStepUp(error) && original && !original._stepUpRetry && !original.url?.includes('/auth/step-up') && stepUpHandler) {
      original._stepUpRetry = true;
      try {
        steppingUp = steppingUp ?? stepUpHandler();
        await steppingUp;
        return api(original);
      } catch {
        return Promise.reject(error);
      } finally {
        steppingUp = null;
      }
    }

    if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      refreshing = refreshing ?? refreshAccessToken();
      const token = await refreshing;
      refreshing = null;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** Extract a human-friendly message from an axios error. */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { error?: { message?: string } })?.error?.message ?? error.message ?? fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
