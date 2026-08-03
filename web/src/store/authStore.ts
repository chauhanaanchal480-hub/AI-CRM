import { create } from 'zustand';
import { api, setAccessToken } from '@/lib/api';
import type { User, AuthResponse, MfaChallengeResponse } from '@/types';

interface AuthState {
  user: User | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  login: (email: string, password: string) => Promise<MfaChallengeResponse | null>;
  verifyMfa: (challengeToken: string, code: string, rememberDevice: boolean) => Promise<void>;
  register: (input: { email: string; password: string; firstName: string; lastName: string }) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'idle',

  login: async (email, password) => {
    const res = await api.post<{ data: AuthResponse | MfaChallengeResponse }>('/auth/login', { email, password });
    if ('mfaRequired' in res.data.data) return res.data.data;
    setAccessToken(res.data.data.accessToken);
    set({ user: res.data.data.user, status: 'authenticated' });
    return null;
  },

  verifyMfa: async (challengeToken, code, rememberDevice) => {
    const res = await api.post<{ data: AuthResponse }>('/auth/mfa/verify', {
      challengeToken,
      code,
      rememberDevice,
    });
    setAccessToken(res.data.data.accessToken);
    set({ user: res.data.data.user, status: 'authenticated' });
  },

  register: async (input) => {
    const res = await api.post<{ data: AuthResponse }>('/auth/register', input);
    setAccessToken(res.data.data.accessToken);
    set({ user: res.data.data.user, status: 'authenticated' });
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      set({ user: null, status: 'unauthenticated' });
    }
  },

  // On first load, try to restore a session using the refresh cookie.
  bootstrap: async () => {
    set({ status: 'loading' });
    try {
      const refresh = await api.post<{ data: AuthResponse }>('/auth/refresh');
      setAccessToken(refresh.data.data.accessToken);
      const me = await api.get<{ data: User }>('/auth/me');
      set({ user: me.data.data, status: 'authenticated' });
    } catch {
      setAccessToken(null);
      set({ user: null, status: 'unauthenticated' });
    }
  },

  setUser: (user) => set({ user }),
}));
