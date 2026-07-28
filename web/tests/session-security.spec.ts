import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';

const credentials = { email: 'admin@crm.dev', password: 'Password123!' };

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

async function newClient(playwright: Playwright, baseURL: string | undefined, userAgent: string) {
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'User-Agent': userAgent } });
}

async function login(client: APIRequestContext) {
  const response = await client.post('/api/auth/login', { data: credentials });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: LoginResult }).data;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Enterprise session security', () => {
  test('login persists the current device, history, and last-login metadata', async ({ playwright, baseURL }) => {
    const client = await newClient(
      playwright,
      baseURL,
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
    );
    try {
      const session = await login(client);
      const sessionsResponse = await client.get('/api/auth/sessions', { headers: auth(session.accessToken) });
      expect(sessionsResponse.status()).toBe(200);
      const sessions = ((await sessionsResponse.json()) as {
        data: Array<Record<string, unknown>>;
      }).data;
      const current = sessions.find(({ sessionId }) => sessionId === session.sessionId);
      expect(current).toMatchObject({
        current: true,
        browser: 'Chrome 126.0.0.0',
        operatingSystem: 'Windows 10/11',
        deviceType: 'Desktop',
        location: null,
      });
      expect(current?.issuedAt).toBeTruthy();
      expect(current?.lastActivity).toBeTruthy();
      expect(current?.expiresAt).toBeTruthy();
      expect(current?.ip).toBeTruthy();

      const failed = await client.post('/api/auth/login', {
        data: { ...credentials, password: 'WrongPassword1' },
      });
      expect(failed.status()).toBe(401);

      const historyResponse = await client.get('/api/auth/login-history', { headers: auth(session.accessToken) });
      expect(historyResponse.status()).toBe(200);
      const history = ((await historyResponse.json()) as {
        data: {
          metadata: Record<string, string | null>;
          history: Array<{ success: boolean; sessionId: string | null }>;
        };
      }).data;
      expect(history.metadata.currentLogin).toBeTruthy();
      expect(history.metadata.lastFailedLogin).toBeTruthy();
      expect(history.history).toEqual(expect.arrayContaining([
        expect.objectContaining({ success: true, sessionId: session.sessionId }),
        expect.objectContaining({ success: false, sessionId: null }),
      ]));
    } finally {
      await client.dispose();
    }
  });

  test('a selected device can be revoked without ending the current session', async ({ playwright, baseURL }) => {
    const currentClient = await newClient(playwright, baseURL, 'Mozilla/5.0 Chrome/126.0.0.0 Windows');
    const otherClient = await newClient(playwright, baseURL, 'Mozilla/5.0 Firefox/127.0 Linux');
    try {
      const current = await login(currentClient);
      const other = await login(otherClient);
      const revoke = await currentClient.delete(`/api/auth/sessions/${other.sessionId}`, {
        headers: auth(current.accessToken),
      });
      expect(revoke.status()).toBe(200);
      expect((await currentClient.get('/api/auth/me', { headers: auth(current.accessToken) })).status()).toBe(200);
      expect((await otherClient.get('/api/auth/me', { headers: auth(other.accessToken) })).status()).toBe(401);
      expect((await otherClient.post('/api/auth/refresh', { data: { refreshToken: other.refreshToken } })).status()).toBe(401);
    } finally {
      await currentClient.dispose();
      await otherClient.dispose();
    }
  });

  test('logout-others preserves only the requesting device', async ({ playwright, baseURL }) => {
    const currentClient = await newClient(playwright, baseURL, 'Session Test Current Chrome/126.0');
    const otherClient = await newClient(playwright, baseURL, 'Session Test Other Firefox/127.0');
    try {
      const current = await login(currentClient);
      const other = await login(otherClient);
      const response = await currentClient.post('/api/auth/sessions/logout-others', {
        headers: auth(current.accessToken),
      });
      expect(response.status()).toBe(200);
      expect((await currentClient.get('/api/auth/me', { headers: auth(current.accessToken) })).status()).toBe(200);
      expect((await otherClient.get('/api/auth/me', { headers: auth(other.accessToken) })).status()).toBe(401);
    } finally {
      await currentClient.dispose();
      await otherClient.dispose();
    }
  });

  test('current-session and all-device logout revoke access and refresh tokens', async ({ playwright, baseURL }) => {
    const firstClient = await newClient(playwright, baseURL, 'Session Test First Chrome/126.0');
    const secondClient = await newClient(playwright, baseURL, 'Session Test Second Safari/17.0');
    try {
      const first = await login(firstClient);
      const second = await login(secondClient);
      const currentLogout = await firstClient.delete('/api/auth/sessions/current', {
        headers: auth(first.accessToken),
      });
      expect(currentLogout.status()).toBe(200);
      expect((await firstClient.get('/api/auth/me', { headers: auth(first.accessToken) })).status()).toBe(401);
      expect((await secondClient.get('/api/auth/me', { headers: auth(second.accessToken) })).status()).toBe(200);

      const allLogout = await secondClient.post('/api/auth/sessions/logout-all', {
        headers: auth(second.accessToken),
      });
      expect(allLogout.status()).toBe(200);
      expect((await secondClient.get('/api/auth/me', { headers: auth(second.accessToken) })).status()).toBe(401);
      expect((await secondClient.post('/api/auth/refresh', { data: { refreshToken: second.refreshToken } })).status()).toBe(401);
    } finally {
      await firstClient.dispose();
      await secondClient.dispose();
    }
  });
});
