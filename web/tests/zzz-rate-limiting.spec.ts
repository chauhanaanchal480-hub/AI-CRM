import { test, expect } from './helpers/fixtures';

interface AuditLog {
  action: string;
  statusCode: number;
  requestId: string;
  userId: string | null;
}

test.describe('Enterprise rate limiting', () => {
  test('publishes global, IP, user, login, AI, upload, and export policies', async ({ api, request }) => {
    const anonymous = await request.get('/api');
    expect(anonymous.status()).toBe(200);
    expect(anonymous.headers()['ratelimit-policy']).toContain('global;');
    expect(anonymous.headers()['ratelimit-policy']).toContain('ip;');
    expect(anonymous.headers()['x-ratelimit-scope']).toBe('ip');

    const authenticated = await api.request.get('/api', { headers: api.authHeaders });
    expect(authenticated.status()).toBe(200);
    expect(authenticated.headers()['ratelimit-policy']).toContain('user;');
    expect(authenticated.headers()['x-ratelimit-scope']).toBe('user');

    const login = await request.post('/api/auth/login', { data: {} });
    expect(login.status()).toBe(400);
    expect(login.headers()['ratelimit-policy']).toContain('login;');
    expect(login.headers()['x-ratelimit-scope']).toBe('login');

    const ai = await api.request.post('/api/ai/customers/not-a-cuid/summarize', { headers: api.authHeaders });
    expect(ai.status()).toBe(400);
    expect(ai.headers()['ratelimit-policy']).toContain('ai;');
    expect(ai.headers()['x-ratelimit-scope']).toBe('ai');

    const upload = await api.request.post('/api/uploads', { headers: api.authHeaders });
    expect(upload.status()).toBe(400);
    expect(upload.headers()['ratelimit-policy']).toContain('upload;');
    expect(upload.headers()['x-ratelimit-scope']).toBe('upload');

    const exported = await api.request.get('/api/export/not-an-entity/pdf', { headers: api.authHeaders });
    expect(exported.status()).toBe(400);
    expect(exported.headers()['ratelimit-policy']).toContain('export;');
    expect(exported.headers()['x-ratelimit-scope']).toBe('export');
  });

  test('returns Retry-After and writes an audit event when a sliding-window budget is exhausted', async ({ api }) => {
    let blocked;

    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await api.request.get('/api/export/not-an-entity/pdf', {
        headers: api.authHeaders,
      });
      if (response.status() === 429) {
        blocked = response;
        break;
      }
    }

    expect(blocked, 'export policy should be exhausted within its configured budget').toBeDefined();
    expect(blocked!.headers()['retry-after']).toMatch(/^\d+$/);
    expect(Number(blocked!.headers()['retry-after'])).toBeGreaterThan(0);
    expect(blocked!.headers()['ratelimit-remaining']).toBe('0');
    expect(blocked!.headers()['x-ratelimit-scope']).toBe('export');
    expect(await blocked!.json()).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMITED', details: { policy: 'export' } },
    });

    const blockedRequestId = blocked!.headers()['x-request-id'];
    expect(blockedRequestId).toBeTruthy();

    let auditLogs: AuditLog[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const audit = await api.request.get(`/api/audit?requestId=${encodeURIComponent(blockedRequestId)}`, {
        headers: api.authHeaders,
      });
      expect(audit.status()).toBe(200);
      auditLogs = ((await audit.json()) as { data: AuditLog[] }).data;
      if (auditLogs.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(auditLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'RATE_LIMITED', statusCode: 429, requestId: blockedRequestId }),
    ]));
  });
});
