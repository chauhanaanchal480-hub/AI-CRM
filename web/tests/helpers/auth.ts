import type { BrowserContext, Page } from '@playwright/test';

export type RoleKey = 'admin' | 'manager' | 'employee';

export const USERS: Record<RoleKey, { email: string; password: string; firstName: string }> = {
  admin: { email: 'admin@crm.dev', password: 'Password123!', firstName: 'Ava' },
  manager: { email: 'manager@crm.dev', password: 'Password123!', firstName: 'Marcus' },
  employee: { email: 'sam@crm.dev', password: 'Password123!', firstName: 'Sam' },
};

/**
 * Authenticate through the API instead of the login form.
 *
 * The server sets the httpOnly `refreshToken` cookie on the shared context
 * cookie jar. Returns the access token for direct API calls.
 *
 * Retries on 409: two parallel workers logging in the same user within the
 * same second mint byte-identical refresh JWTs (same sub + iat), which
 * collide on the token table's unique constraint.
 */
const tokenCache = new Map<RoleKey, { token: string; at: number }>();
// Access tokens live 15m; refresh cached tokens well before expiry.
const TOKEN_TTL_MS = 10 * 60 * 1000;

export async function loginViaApi(
  context: BrowserContext,
  role: RoleKey = 'admin',
  opts?: { fresh?: boolean },
): Promise<string> {
  // Reuse tokens across tests: the auth endpoint is rate-limited (50/15min),
  // and a full run performs 100+ logins without caching, which trips the
  // limiter mid-suite and makes pass counts nondeterministic.
  const cached = tokenCache.get(role);
  if (!opts?.fresh && cached && Date.now() - cached.at < TOKEN_TTL_MS) {
    const validation = await context.request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${cached.token}` },
    });
    if (validation.ok()) return cached.token;
    if (validation.status() !== 401) {
      throw new Error(`Cached API session validation failed: ${validation.status()} ${await validation.text()}`);
    }
    tokenCache.delete(role);
  }
  const user = USERS[role];
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await context.request.post('/api/auth/login', {
      data: { email: user.email, password: user.password },
    });
    if (res.ok()) {
      const json = (await res.json()) as { data: { accessToken: string } };
      tokenCache.set(role, { token: json.data.accessToken, at: Date.now() });
      return json.data.accessToken;
    }
    if (res.status() === 409) {
      // Wait past the current JWT `iat` second so the next token is unique.
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      continue;
    }
    throw new Error(`API login failed for ${user.email}: ${res.status()} ${await res.text()}`);
  }
  throw new Error(`API login failed for ${user.email}: exhausted retries on 409 token collision`);
}

/**
 * Make the SPA's bootstrap deterministic by fulfilling POST /auth/refresh
 * with a token we already hold.
 *
 * Why: the app bootstraps by POSTing /auth/refresh on every full page load,
 * and React StrictMode (dev) fires it twice. Server-side single-use token
 * rotation makes that race non-deterministic (the losing call 401s and can
 * flip the session to unauthenticated). Stubbing only this endpoint keeps
 * every other request real.
 */
export async function stubRefresh(page: Page, token: string) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { accessToken: token } }),
    }),
  );
}
