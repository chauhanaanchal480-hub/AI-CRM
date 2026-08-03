import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { totpCode } from '../../server/src/modules/auth/totp.ts';

const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

async function isolatedClient(playwright: Playwright, baseURL: string | undefined, userAgent: string) {
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'User-Agent': userAgent } });
}

async function register(client: APIRequestContext, password: string) {
  const email = `phase26-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@test.dev`;
  const response = await client.post('/api/auth/register', {
    data: { email, password, firstName: 'Phase', lastName: 'TwentySix' },
  });
  expect(response.status()).toBe(201);
  const data = ((await response.json()) as {
    data: { accessToken: string; sessionId: string; user: { id: string; email: string } };
  }).data;
  return { ...data, email };
}

test.describe('Enterprise authentication hardening', () => {
  test('supports TOTP, recovery codes, trusted devices, device risk, and MFA step-up', async ({ playwright, baseURL }) => {
    const password = 'Phase26-Strong-Login-7419';
    const enrollmentClient = await isolatedClient(playwright, baseURL, 'Phase26 Enrollment Chrome/140 Windows');
    const trustedClient = await isolatedClient(playwright, baseURL, 'Phase26 Trusted Firefox/141 Linux');
    const recoveryClient = await isolatedClient(playwright, baseURL, 'Phase26 Recovery Safari/18 macOS');
    try {
      const enrolled = await register(enrollmentClient, password);
      const enrollmentAuth = auth(enrolled.accessToken);

      const setup = await enrollmentClient.post('/api/auth/mfa/setup', { headers: enrollmentAuth });
      expect(setup.status()).toBe(200);
      const setupData = ((await setup.json()) as { data: { secret: string; provisioningUri: string } }).data;
      expect(setupData.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setupData.provisioningUri).toContain('otpauth://totp/');
      expect(setupData.provisioningUri).toContain(encodeURIComponent(enrolled.email));

      const enabled = await enrollmentClient.post('/api/auth/mfa/enable', {
        headers: enrollmentAuth,
        data: { code: totpCode(setupData.secret) },
      });
      expect(enabled.status()).toBe(200);
      const recoveryCodes = ((await enabled.json()) as { data: { recoveryCodes: string[] } }).data.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);

      const challenged = await trustedClient.post('/api/auth/login', {
        data: { email: enrolled.email, password },
      });
      expect(challenged.status()).toBe(200);
      const challenge = ((await challenged.json()) as {
        data: { mfaRequired: boolean; challengeToken: string; risk: { level: string; reasons: string[] } };
      }).data;
      expect(challenge.mfaRequired).toBe(true);
      expect(challenge.risk.reasons).toContain('NEW_DEVICE');

      const verified = await trustedClient.post('/api/auth/mfa/verify', {
        data: { challengeToken: challenge.challengeToken, code: totpCode(setupData.secret), rememberDevice: true },
      });
      expect(verified.status()).toBe(200);
      const verifiedSession = ((await verified.json()) as { data: { accessToken: string; sessionId: string } }).data;

      const steppedUp = await trustedClient.post('/api/auth/step-up', {
        headers: auth(verifiedSession.accessToken),
        data: { code: totpCode(setupData.secret) },
      });
      expect(steppedUp.status()).toBe(200);
      expect(((await steppedUp.json()) as { data: { expiresInSeconds: number } }).data.expiresInSeconds).toBe(600);

      const trustedDevices = await trustedClient.get('/api/auth/trusted-devices', {
        headers: auth(verifiedSession.accessToken),
      });
      const devices = ((await trustedDevices.json()) as { data: Array<{ id: string; label: string }> }).data;
      expect(devices).toHaveLength(1);
      expect(devices[0].label).toContain('Firefox');

      expect((await trustedClient.delete('/api/auth/sessions/current', {
        headers: auth(verifiedSession.accessToken),
      })).status()).toBe(200);
      const trustedLogin = await trustedClient.post('/api/auth/login', { data: { email: enrolled.email, password } });
      expect(trustedLogin.status()).toBe(200);
      const trustedLoginData = ((await trustedLogin.json()) as {
        data: { accessToken?: string; mfaRequired?: boolean; risk: { level: string } };
      }).data;
      expect(trustedLoginData.accessToken).toBeTruthy();
      expect(trustedLoginData.mfaRequired).toBeUndefined();
      expect(trustedLoginData.risk.level).toBe('LOW');

      expect((await trustedClient.delete(`/api/auth/trusted-devices/${devices[0].id}`, {
        headers: auth(trustedLoginData.accessToken!),
      })).status()).toBe(200);
      expect((await trustedClient.delete('/api/auth/sessions/current', {
        headers: auth(trustedLoginData.accessToken!),
      })).status()).toBe(200);
      const noLongerTrusted = await trustedClient.post('/api/auth/login', { data: { email: enrolled.email, password } });
      expect(((await noLongerTrusted.json()) as { data: { mfaRequired: boolean } }).data.mfaRequired).toBe(true);

      const recoveryChallengeResponse = await recoveryClient.post('/api/auth/login', {
        data: { email: enrolled.email, password },
      });
      const recoveryChallenge = ((await recoveryChallengeResponse.json()) as {
        data: { challengeToken: string };
      }).data;
      const recovered = await recoveryClient.post('/api/auth/mfa/verify', {
        data: { challengeToken: recoveryChallenge.challengeToken, code: recoveryCodes[0], rememberDevice: false },
      });
      expect(recovered.status()).toBe(200);
      const recoveredToken = ((await recovered.json()) as { data: { accessToken: string } }).data.accessToken;

      const reuseChallengeResponse = await recoveryClient.post('/api/auth/login', {
        data: { email: enrolled.email, password },
      });
      const reuseChallenge = ((await reuseChallengeResponse.json()) as { data: { challengeToken: string } }).data;
      expect((await recoveryClient.post('/api/auth/mfa/verify', {
        data: { challengeToken: reuseChallenge.challengeToken, code: recoveryCodes[0], rememberDevice: false },
      })).status()).toBe(401);

      const status = await recoveryClient.get('/api/auth/mfa/status', { headers: auth(recoveredToken) });
      expect(await status.json()).toMatchObject({ data: { mfaEnabled: true, recoveryCodesRemaining: 9 } });
      expect((await recoveryClient.post('/api/auth/mfa/disable', {
        headers: auth(recoveredToken),
        data: { code: totpCode(setupData.secret) },
      })).status()).toBe(200);

      const normalLogin = await recoveryClient.post('/api/auth/login', { data: { email: enrolled.email, password } });
      expect(((await normalLogin.json()) as { data: { accessToken: string } }).data.accessToken).toBeTruthy();
    } finally {
      await enrollmentClient.dispose();
      await trustedClient.dispose();
      await recoveryClient.dispose();
    }
  });

  test('prevents password reuse and breached passwords while supporting password step-up', async ({ playwright, baseURL }) => {
    const client = await isolatedClient(playwright, baseURL, 'Phase26 Password History Chrome/140');
    const originalPassword = 'Phase26-Original-Password-8527';
    const newPassword = 'Phase26-Rotated-Password-9638';
    try {
      const user = await register(client, originalPassword);
      const headers = auth(user.accessToken);

      expect((await client.post('/api/auth/step-up', {
        headers,
        data: { password: 'incorrect-password' },
      })).status()).toBe(401);
      expect((await client.post('/api/auth/step-up', {
        headers,
        data: { password: originalPassword },
      })).status()).toBe(200);

      expect((await client.post('/api/users/me/password', {
        headers,
        data: { currentPassword: originalPassword, newPassword },
      })).status()).toBe(200);

      const reused = await client.post('/api/users/me/password', {
        headers,
        data: { currentPassword: newPassword, newPassword: originalPassword },
      });
      expect(reused.status()).toBe(400);
      expect(((await reused.json()) as { error: { message: string } }).error.message).toMatch(/last 5 passwords/i);

      const breached = await client.post('/api/users/me/password', {
        headers,
        data: { currentPassword: newPassword, newPassword: 'Password123!' },
      });
      expect(breached.status()).toBe(400);
      expect(((await breached.json()) as { error: { message: string } }).error.message).toMatch(/known data breach/i);

      expect((await client.post('/api/auth/login', {
        data: { email: user.email, password: originalPassword },
      })).status()).toBe(401);
      expect((await client.post('/api/auth/login', {
        data: { email: user.email, password: newPassword },
      })).status()).toBe(200);
    } finally {
      await client.dispose();
    }
  });

  test('locks an MFA challenge after repeated invalid codes and requires a new challenge', async ({ playwright, baseURL }) => {
    const password = 'Phase26-Challenge-Protection-4827';
    const enrollmentClient = await isolatedClient(playwright, baseURL, 'Challenge Enrollment Chrome/140 Windows');
    const loginClient = await isolatedClient(playwright, baseURL, 'Challenge Login Firefox/141 Linux');
    try {
      const enrolled = await register(enrollmentClient, password);
      const headers = auth(enrolled.accessToken);
      const setup = await enrollmentClient.post('/api/auth/mfa/setup', { headers });
      const secret = ((await setup.json()) as { data: { secret: string } }).data.secret;
      expect((await enrollmentClient.post('/api/auth/mfa/enable', {
        headers,
        data: { code: totpCode(secret) },
      })).status()).toBe(200);

      const login = await loginClient.post('/api/auth/login', { data: { email: enrolled.email, password } });
      const challengeToken = ((await login.json()) as { data: { challengeToken: string } }).data.challengeToken;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect((await loginClient.post('/api/auth/mfa/verify', {
          data: { challengeToken, code: '000000', rememberDevice: false },
        })).status()).toBe(401);
      }
      const locked = await loginClient.post('/api/auth/mfa/verify', {
        data: { challengeToken, code: '000000', rememberDevice: false },
      });
      expect(locked.status()).toBe(429);
      expect(await locked.json()).toMatchObject({ error: { details: { code: 'MFA_CHALLENGE_LOCKED' } } });
      expect((await loginClient.post('/api/auth/mfa/verify', {
        data: { challengeToken, code: totpCode(secret), rememberDevice: false },
      })).status()).toBe(429);

      const replacementLogin = await loginClient.post('/api/auth/login', { data: { email: enrolled.email, password } });
      const replacementToken = ((await replacementLogin.json()) as { data: { challengeToken: string } }).data.challengeToken;
      expect(replacementToken).not.toBe(challengeToken);
      expect((await loginClient.post('/api/auth/mfa/verify', {
        data: { challengeToken: replacementToken, code: totpCode(secret), rememberDevice: false },
      })).status()).toBe(200);
    } finally {
      await enrollmentClient.dispose();
      await loginClient.dispose();
    }
  });

  test('blocks a high-risk login when the account has no enrolled MFA factor', async ({ playwright, baseURL }) => {
    const password = 'Phase26-Adaptive-Risk-5938';
    const client = await isolatedClient(playwright, baseURL, 'Adaptive Risk Chrome/140 Windows');
    try {
      const user = await register(client, password);
      expect((await client.delete('/api/auth/sessions/current', { headers: auth(user.accessToken) })).status()).toBe(200);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await client.post('/api/auth/login', {
          data: { email: user.email, password: `${password}-wrong` },
        })).status()).toBe(401);
      }
      const blocked = await client.post('/api/auth/login', { data: { email: user.email, password } });
      expect(blocked.status()).toBe(403);
      expect(await blocked.json()).toMatchObject({
        error: {
          details: {
            code: 'HIGH_RISK_LOGIN_BLOCKED',
            risk: { level: 'HIGH', reasons: expect.arrayContaining(['RECENT_FAILED_LOGINS']) },
          },
        },
      });
    } finally {
      await client.dispose();
    }
  });
});
