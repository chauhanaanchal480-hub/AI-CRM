import { test, expect, toast, uniqueName } from './helpers/fixtures';
import { stubRefresh, USERS } from './helpers/auth';

test.describe('Profile', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/app/profile');
    await expect(page.getByRole('heading', { name: /my profile/i })).toBeVisible();
  });

  test('Identity card shows current user info and role', async ({ authedPage: page }) => {
    await expect(page.getByText(USERS.admin.email).first()).toBeVisible();
    await expect(page.getByText(/^admin$/i).first()).toBeVisible();
  });

  test('Update job title and phone', async ({ authedPage: page, api }) => {
    const title = uniqueName('QA Title');

    await page.getByLabel(/job title/i).fill(title);
    await page.getByLabel(/^phone$/i).fill('+1 555 000 1234');
    await page.getByRole('button', { name: /save changes/i }).click();

    await toast(page, /profile updated/i);
    await expect(page.getByText(title).first()).toBeVisible();

    // Restore seed value so reruns stay clean
    await api.request.patch('/api/users/me', {
      headers: api.authHeaders,
      data: { title: 'Head of Revenue', phone: '+1 415 555 0100' },
    });
  });

  test('Profile validation - first name required', async ({ authedPage: page }) => {
    await page.getByLabel(/first name/i).clear();
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/^Required$/).first()).toBeVisible();
  });

  test('Profile validation - avatar URL must be a valid URL', async ({ authedPage: page }) => {
    await page.getByLabel(/avatar url/i).fill('not a url');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/invalid url/i)).toBeVisible();
  });

  test('Password validation - new password minimum length', async ({ authedPage: page }) => {
    await page.getByLabel(/current password/i).fill('Password123!');
    await page.getByLabel(/new password/i).fill('short');
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test('Wrong current password is rejected by the server', async ({ authedPage: page }) => {
    await page.getByLabel(/current password/i).fill('WrongPassword999!');
    await page.getByLabel(/new password/i).fill('NewValidPassword123!');
    await page.getByRole('button', { name: /update password/i }).click();

    await toast(page, /current password is incorrect/i);
  });

});

test('Change password for a disposable account', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `profile-password-${suffix}@test.dev`;
  const initialPassword = 'Regression-Initial-7419!';
  const changedPassword = 'Regression-Changed-8520!';
  const registration = await page.request.post('/api/auth/register', {
    data: {
      firstName: 'Password',
      lastName: 'Regression',
      email,
      password: initialPassword,
    },
  });
  expect(registration.status()).toBe(201);
  const token = ((await registration.json()) as { data: { accessToken: string } }).data.accessToken;
  await stubRefresh(page, token);

  await page.goto('/app/profile');
  await expect(page.getByRole('heading', { name: /my profile/i })).toBeVisible();
  await page.getByLabel(/current password/i).fill(initialPassword);
  await page.getByLabel(/new password/i).fill(changedPassword);
  await page.getByRole('button', { name: /update password/i }).click();
  await toast(page, /password changed/i);
});

test.describe('Settings', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: /^Settings$/ })).toBeVisible();
  });

  test('Appearance, team and about sections render for admin', async ({ authedPage: page }) => {
    await expect(page.getByText(/^Appearance$/)).toBeVisible();
    await expect(page.getByText(/team & roles/i)).toBeVisible();
    await expect(page.getByText(/^About$/)).toBeVisible();
    await expect(page.getByText(/\d+ members/)).toBeVisible();
  });

  test('Theme switches between light and dark', async ({ authedPage: page }) => {
    const html = page.locator('html');

    await page.getByRole('button', { name: /^Light$/ }).click();
    await expect(html).not.toHaveClass(/dark/);

    await page.getByRole('button', { name: /^Dark$/ }).click();
    await expect(html).toHaveClass(/dark/);
  });

  test('Theme persists across reloads', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: /^Light$/ }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    await page.reload();
    await expect(page.getByRole('heading', { name: /^Settings$/ })).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // Restore default
    await page.getByRole('button', { name: /^Dark$/ }).click();
  });

  test('Team list shows members with role selectors; own row is locked', async ({ authedPage: page }) => {
    await expect(page.getByText('(you)')).toBeVisible();
    const ownRow = page.locator('div.flex.items-center', { hasText: '(you)' }).first();
    await expect(ownRow.locator('select')).toBeDisabled();
  });

  test('Admin can change another member role and revert it', async ({ authedPage: page, api }) => {
    // Find Nina (seed employee not used for role-based fixtures)
    const usersRes = await api.request.get('/api/users', { headers: api.authHeaders });
    const users = ((await usersRes.json()) as { data: { id: string; email: string; role: string }[] }).data;
    const nina = users.find((u) => u.email === 'nina@crm.dev');
    test.skip(!nina, 'Seed user nina@crm.dev not present');

    const row = page.locator('div.flex.items-center', { hasText: 'nina@crm.dev' }).first();
    await row.locator('select').selectOption('SALES_MANAGER');
    await toast(page, /user updated/i);

    // Revert via API to keep the environment stable
    const revert = await api.request.patch(`/api/users/${nina!.id}`, {
      headers: api.authHeaders,
      data: { role: nina!.role },
    });
    expect(revert.ok()).toBeTruthy();
  });
});

test.describe('Settings - non-admin view', () => {
  test.use({ role: 'employee' });

  test('Employee does not see team management', async ({ authedPage: page }) => {
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: /^Settings$/ })).toBeVisible();

    await expect(page.getByText(/^Appearance$/)).toBeVisible();
    await expect(page.getByText(/team & roles/i)).toBeHidden();
  });
});
