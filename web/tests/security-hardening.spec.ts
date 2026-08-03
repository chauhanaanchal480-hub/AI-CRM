import { test, expect } from '@playwright/test';

test.describe('Security hardening', () => {
  test('Malformed JSON body returns 400, not a stack trace', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: '{"email": "broken',
    });
    expect(res.status()).toBe(400);
    const body = await res.text();
    expect(body).not.toMatch(/at\s+\w+\s+\(|node_modules|\.ts:\d+/);
    expect((JSON.parse(body) as { error: { message: string } }).error.message).toMatch(/malformed json/i);
  });

  test('Registration rejects weak passwords (policy enforced server-side)', async ({ request }) => {
    for (const password of ['alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere', 'Sh0rt']) {
      const res = await request.post('/api/auth/register', {
        data: { email: `weak${Date.now()}@test.dev`, password, firstName: 'Weak', lastName: 'Pass' },
      });
      expect(res.status(), `password "${password}" should be rejected`).toBe(400);
    }
  });

  test('Forgot password responds identically for known and unknown emails', async ({ request }) => {
    const known = await request.post('/api/auth/forgot-password', { data: { email: 'admin@crm.dev' } });
    const unknown = await request.post('/api/auth/forgot-password', { data: { email: `nobody${Date.now()}@test.dev` } });
    expect(known.status()).toBe(200);
    expect(unknown.status()).toBe(200);
    const a = (await known.json()) as { data: { message: string } };
    const b = (await unknown.json()) as { data: { message: string } };
    expect(a.data.message).toBe(b.data.message);
  });

  test('Reset password rejects invalid and expired tokens', async ({ request }) => {
    const res = await request.post('/api/auth/reset-password', {
      data: { token: 'not-a-valid-token', password: 'NewValidPassword1' },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/invalid|expired/i);
  });

  test('Repeated failed logins lock the account temporarily', async ({ request }) => {
    const email = `locked${Date.now()}@test.dev`;
    // 5 failures trips the per-account lock.
    for (let i = 0; i < 5; i++) {
      const res = await request.post('/api/auth/login', {
        data: { email, password: 'WrongPassword1' },
      });
      expect(res.status()).toBe(401);
    }
    const locked = await request.post('/api/auth/login', {
      data: { email, password: 'WrongPassword1' },
    });
    expect(locked.status()).toBe(429);
  });

  test('Refresh-token reuse invalidates the rotated successor', async ({ playwright, baseURL }) => {
    const session = await playwright.request.newContext({ baseURL });
    const replay = await playwright.request.newContext({ baseURL });
    try {
      const login = await session.post('/api/auth/login', {
        data: { email: 'admin@crm.dev', password: 'Password123!' },
      });
      const oldToken = ((await login.json()) as { data: { refreshToken: string } }).data.refreshToken;
      const refresh = await session.post('/api/auth/refresh');
      expect(refresh.status()).toBe(200);
      const newToken = ((await refresh.json()) as { data: { refreshToken: string } }).data.refreshToken;

      expect((await replay.post('/api/auth/refresh', { data: { refreshToken: oldToken } })).status()).toBe(401);
      expect((await replay.post('/api/auth/refresh', { data: { refreshToken: newToken } })).status()).toBe(401);
    } finally {
      await session.dispose();
      await replay.dispose();
    }
  });

  test('Logout invalidates every active refresh token for the account', async ({ playwright, baseURL }) => {
    const first = await playwright.request.newContext({ baseURL });
    const second = await playwright.request.newContext({ baseURL });
    const verifier = await playwright.request.newContext({ baseURL });
    try {
      const firstLogin = await first.post('/api/auth/login', {
        data: { email: 'admin@crm.dev', password: 'Password123!' },
      });
      const secondLogin = await second.post('/api/auth/login', {
        data: { email: 'admin@crm.dev', password: 'Password123!' },
      });
      const firstToken = ((await firstLogin.json()) as { data: { refreshToken: string } }).data.refreshToken;
      expect(firstLogin.status()).toBe(200);
      expect(secondLogin.status()).toBe(200);
      expect((await first.post('/api/auth/logout')).status()).toBe(200);

      expect((await verifier.post('/api/auth/refresh', { data: { refreshToken: firstToken } })).status()).toBe(401);
      expect((await second.post('/api/auth/refresh')).status()).toBe(401);
    } finally {
      await first.dispose();
      await second.dispose();
      await verifier.dispose();
    }
  });

  test('SQL injection payloads in search are handled as plain strings', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    expect(login.ok()).toBeTruthy();
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const headers = { Authorization: `Bearer ${token}` };

    const res = await request.get(`/api/customers?search=${encodeURIComponent("'; DROP TABLE \"User\"; --")}`, { headers });
    expect(res.ok()).toBeTruthy();
    const { data } = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(data)).toBeTruthy();

    // Table still intact.
    const after = await request.get('/api/customers?limit=1', { headers });
    expect(after.ok()).toBeTruthy();
  });

  test('Invalid enum and out-of-range query params are rejected with 400', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const headers = { Authorization: `Bearer ${token}` };

    expect((await request.get('/api/customers?status=NOT_A_STATUS', { headers })).status()).toBe(400);
    expect((await request.get('/api/customers?limit=99999', { headers })).status()).toBe(400);
    expect((await request.get('/api/customers?page=0', { headers })).status()).toBe(400);
    expect((await request.get('/api/activities?type=NOT_A_TYPE', { headers })).status()).toBe(400);
  });

  test('Executable file uploads are blocked', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;

    const res = await request.post('/api/uploads', {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: { name: 'evil.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ...') },
      },
    });
    expect(res.status()).toBe(400);
  });

  test('Upload with spoofed MIME type fails magic-byte validation', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;

    // Claims to be a PNG but the bytes are a script.
    const res = await request.post('/api/uploads', {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<script>alert(1)</script>') },
      },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/does not match/i);
  });

  test('Upload rejects a MIME type that does not match the filename extension', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const res = await request.post('/api/uploads', {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: { name: 'invoice.txt', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF') },
      },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/extension.*declared type/i);
  });

  test('Upload rejects binary content disguised as text or an OOXML document', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const headers = { Authorization: `Bearer ${token}` };
    const attempts = [
      { name: 'binary.txt', mimeType: 'text/plain', buffer: Buffer.from([0x4d, 0x5a, 0x00, 0x01]) },
      {
        name: 'fake.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
      },
    ];
    for (const file of attempts) {
      const res = await request.post('/api/uploads', { headers, multipart: { file } });
      expect(res.status()).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/content.*declared type/i);
    }
  });

  test('Security headers are complete on API responses', async ({ request }) => {
    const res = await request.get('/health');
    const headers = res.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    const csp = headers['content-security-policy'];
    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "script-src 'self'",
      "script-src-attr 'none'",
      "style-src 'self'",
      "style-src-attr 'none'",
      "worker-src 'none'",
      'upgrade-insecure-requests',
    ]) {
      expect(csp).toContain(directive);
    }
    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['permissions-policy']).toContain('microphone=()');
    expect(headers['permissions-policy']).toContain('geolocation=()');
    expect(headers['permissions-policy']).toContain('payment=()');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('Security headers are applied to non-success responses', async ({ request }) => {
    const res = await request.get('/api/route-that-does-not-exist');
    expect(res.status()).toBe(404);

    const headers = res.headers();
    expect(headers['content-security-policy']).toBeTruthy();
    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['permissions-policy']).toBeTruthy();
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('CORS allows configured origins and withholds access from untrusted origins', async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: 'http://localhost:4000' });
    const allowedOrigin = process.env.CORS_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5175';
    try {
      const allowed = await api.fetch('/api/auth/login', {
        method: 'OPTIONS',
        headers: {
          Origin: allowedOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,authorization',
        },
      });
      expect(allowed.status()).toBe(204);
      expect(allowed.headers()['access-control-allow-origin']).toBe(allowedOrigin);
      expect(allowed.headers()['access-control-allow-credentials']).toBe('true');
      expect(allowed.headers()['access-control-allow-methods']).not.toContain('TRACE');

      const denied = await api.fetch('/api/auth/login', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://attacker.invalid',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(denied.headers()['access-control-allow-origin']).toBeUndefined();
      expect(denied.headers()['access-control-allow-credentials']).toBeUndefined();
    } finally {
      await api.dispose();
    }
  });

  test('Prisma/SQL details never leak on invalid IDs', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const headers = { Authorization: `Bearer ${token}` };

    for (const url of ['/api/customers/not-a-valid-cuid', '/api/customers/%00', '/api/deals/nonexistent-id-123']) {
      const res = await request.get(url, { headers });
      expect([400, 404]).toContain(res.status());
      const text = await res.text();
      expect(text).not.toMatch(/prisma|PrismaClient|invocation|SELECT|INSERT/i);
    }
  });

  test('Every route parameter rejects invalid resource IDs', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const headers = { Authorization: `Bearer ${token}` };
    const invalidId = 'not-a-valid-cuid';
    const requests = [
      request.get(`/api/customers/${invalidId}`, { headers }),
      request.get(`/api/leads/${invalidId}`, { headers }),
      request.get(`/api/deals/${invalidId}`, { headers }),
      request.get(`/api/tasks/${invalidId}`, { headers }),
      request.delete(`/api/notes/${invalidId}`, { headers }),
      request.patch(`/api/notifications/${invalidId}/read`, { headers }),
      request.delete(`/api/uploads/${invalidId}`, { headers }),
      request.patch(`/api/users/${invalidId}`, { headers, data: { role: 'EMPLOYEE' } }),
      request.post(`/api/ai/customers/${invalidId}/summarize`, { headers }),
      request.post(`/api/ai/customers/${invalidId}/suggest-followups`, { headers }),
      request.post(`/api/ai/customers/${invalidId}/draft-email`, {
        headers,
        data: { purpose: 'Follow up', tone: 'CONCISE' },
      }),
      request.post(`/api/ai/customers/${invalidId}/meeting-summary`, {
        headers,
        data: { transcript: 'Meeting notes', save: false },
      }),
      request.post(`/api/ai/leads/${invalidId}/score`, { headers }),
      request.get(`/api/export/${invalidId}/excel`, { headers }),
      request.get(`/api/export/${invalidId}/pdf`, { headers }),
    ];
    for (const response of await Promise.all(requests)) expect(response.status()).toBe(400);
  });

  test('Admin cannot demote their own account', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    const json = (await login.json()) as { data: { accessToken: string; user: { id: string } } };
    const res = await request.patch(`/api/users/${json.data.user.id}`, {
      headers: { Authorization: `Bearer ${json.data.accessToken}` },
      data: { role: 'EMPLOYEE' },
    });
    expect(res.status()).toBe(403);
  });
});
