import { test, expect, type Page } from '@playwright/test';
import { totpCode } from '../../server/src/modules/auth/totp.ts';

function credentials(prefix: string) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return {
    email: `${prefix}-${suffix}@test.dev`,
    password: `Phase26-${prefix}-Strong-7419`,
  };
}

async function registerThroughBrowser(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByLabel('First name').fill('Browser');
  await page.getByLabel('Last name').fill('Security');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/app\/dashboard/);
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByText('Sign out', { exact: true }).click();
  await page.waitForURL(/\/login/);
}

async function submitPasswordLogin(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test.describe('Phase 2.6 browser authentication workflows', () => {
  test('enrolls MFA and manages recovery, trusted-device, high-risk, and step-up flows', async ({ page }) => {
    const { email, password } = credentials('browser-mfa');
    await registerThroughBrowser(page, email, password);

    await page.getByRole('link', { name: /^Settings$/ }).click();
    await page.waitForURL(/\/app\/settings/);
    await page.getByRole('button', { name: /set up authenticator/i }).click();
    const secret = (await page.getByTestId('mfa-secret').textContent())?.trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel('Authentication code').fill(totpCode(secret!));
    await page.getByRole('button', { name: /verify and enable mfa/i }).click();
    await expect(page.getByTestId('mfa-recovery-code')).toHaveCount(10);
    const recoveryCodes = await page.getByTestId('mfa-recovery-code').allTextContents();

    await signOut(page);
    await submitPasswordLogin(page, email, password);
    await expect(page.getByRole('heading', { name: /verify your identity/i })).toBeVisible();
    await page.getByLabel('Authentication code').fill(totpCode(secret!));
    await page.getByLabel(/remember this device/i).check();
    await page.getByRole('button', { name: /verify and sign in/i }).click();
    await page.waitForURL(/\/app\/dashboard/);

    await signOut(page);
    await submitPasswordLogin(page, email, password);
    await page.waitForURL(/\/app\/dashboard/);
    await expect(page.getByRole('heading', { name: /^Dashboard$/ })).toBeVisible();

    await signOut(page);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await page.request.post('/api/auth/login', {
        data: { email, password: `${password}-wrong` },
      });
      expect(failed.status()).toBe(401);
    }
    await submitPasswordLogin(page, email, password);
    await expect(page.getByRole('heading', { name: /verify your identity/i })).toBeVisible();
    await page.getByLabel('Authentication code').fill(recoveryCodes[0]);
    await page.getByLabel(/remember this device/i).check();
    await page.getByRole('button', { name: /verify and sign in/i }).click();
    await page.waitForURL(/\/app\/dashboard/);

    await page.getByRole('link', { name: /^Settings$/ }).click();
    await page.waitForURL(/\/app\/settings/);
    await expect(page.getByTestId('trusted-device')).toHaveCount(1);
    let requireStepUpOnce = true;
    await page.route('**/api/auth/trusted-devices/*', async (route) => {
      if (route.request().method() === 'DELETE' && requireStepUpOnce) {
        requireStepUpOnce = false;
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              message: 'Step-up authentication required',
              details: { code: 'STEP_UP_REQUIRED', endpoint: '/api/auth/step-up' },
            },
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: /^Revoke / }).click();
    await expect(page.getByRole('heading', { name: 'Verify sensitive action' })).toBeVisible();
    await page.getByLabel('Authentication code', { exact: true }).fill(totpCode(secret!));
    await page.getByRole('button', { name: /verify and continue/i }).click();
    await expect(page.getByTestId('trusted-device')).toHaveCount(0);

    await signOut(page);
    await submitPasswordLogin(page, email, password);
    await expect(page.getByRole('heading', { name: /verify your identity/i })).toBeVisible();
  });

  test('blocks a suspicious browser login when MFA is not enrolled', async ({ page }) => {
    const { email, password } = credentials('browser-risk');
    await registerThroughBrowser(page, email, password);
    await signOut(page);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await page.request.post('/api/auth/login', {
        data: { email, password: `${password}-wrong` },
      });
      expect(failed.status()).toBe(401);
    }
    await submitPasswordLogin(page, email, password);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/blocked because it appears suspicious/i)).toBeVisible();
  });
});
