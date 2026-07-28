import type { APIResponse } from '@playwright/test';
import { test, expect } from './helpers/fixtures';

const SQLI_PAYLOADS = [
  "' OR 1=1 --",
  'UNION SELECT password FROM users',
  'DROP TABLE users; --',
  'information_schema.tables',
  'SLEEP(5)',
  'BENCHMARK(1000000, MD5(1))',
  '/* SQL injection */',
];

const DATABASE_LEAK =
  /PrismaClient|SQLSTATE|syntax error at or near|unterminated quoted string|relation ["'][^"']+["'] does not exist|column ["'][^"']+["'] does not exist|node_modules|\.ts:\d+/i;

async function expectNoDatabaseLeak(response: APIResponse) {
  expect(response.status()).toBeLessThan(500);
  expect(await response.text()).not.toMatch(DATABASE_LEAK);
}

test.describe('SQL injection regression', () => {
  test('login rejects SQL injection payloads without leaking database details', async ({ request }) => {
    for (const payload of SQLI_PAYLOADS) {
      const response = await request.post('/api/auth/login', {
        data: { email: payload, password: payload },
      });
      expect([400, 401, 403, 422]).toContain(response.status());
      await expectNoDatabaseLeak(response);
    }
  });

  test('customer search treats SQL injection payloads as plain text', async ({ api }) => {
    for (const payload of SQLI_PAYLOADS) {
      const response = await api.request.get(`/api/customers?search=${encodeURIComponent(payload)}`, {
        headers: api.authHeaders,
      });
      expect(response.status()).toBe(200);
      await expectNoDatabaseLeak(response);
    }

    const healthCheck = await api.request.get('/api/customers?limit=1', { headers: api.authHeaders });
    expect(healthCheck.status()).toBe(200);
  });

  test('customer filters reject SQL injection payloads safely', async ({ api }) => {
    for (const payload of SQLI_PAYLOADS) {
      const response = await api.request.get(`/api/customers?status=${encodeURIComponent(payload)}`, {
        headers: api.authHeaders,
      });
      expect([400, 401, 403, 422]).toContain(response.status());
      await expectNoDatabaseLeak(response);
    }
  });

  test('dynamic sort queries cannot turn payloads into SQL', async ({ api }) => {
    for (const payload of SQLI_PAYLOADS) {
      const response = await api.request.get(`/api/leads?sortBy=${encodeURIComponent(payload)}`, {
        headers: api.authHeaders,
      });
      expect([200, 400, 401, 403, 422]).toContain(response.status());
      await expectNoDatabaseLeak(response);
    }
  });
});
