import { test, expect } from './helpers/fixtures';
test('Login page loads correctly', async ({ page }) => {
  await page.goto('/login');

  // Wait for page to render
  await page.waitForLoadState('networkidle');

  await expect(page.getByText(/welcome back/i)).toBeVisible();

                                  

  await expect(page.locator('input[name="email"]')).toBeVisible();

  await expect(page.locator('input[name="password"]')).toBeVisible();

  await expect(
    page.getByRole('button', { name: /sign in/i })
  ).toBeVisible();
});
test('User can login', async ({ page }) => {
  await page.goto('/login');

  await page.locator('input[name="email"]').fill('admin@crm.dev');
  await page.locator('input[name="password"]').fill('Password123!');

  await Promise.all([
    page.waitForURL(/app\/dashboard/, { timeout: 15000 }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);

  await expect(page).toHaveURL(/app\/dashboard/);
});
test('Invalid login shows error', async ({ page }) => {
  await page.goto('/login');

  await page.locator('input[name="email"]').fill('wrong@test.com');
  await page.locator('input[name="password"]').fill('WrongPassword123');

  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/login/);

  await expect(page.getByText(/invalid|incorrect|error/i)).toBeVisible();
});
 test('User can logout', async ({ page }) => {
  await page.goto('/login');

  await page.locator('input[name="email"]').fill('admin@crm.dev');
  await page.locator('input[name="password"]').fill('Password123!');

  await Promise.all([
    page.waitForURL(/app\/dashboard/, { timeout: 15000 }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);

  await expect(page).toHaveURL(/app\/dashboard/);

  // Profile menu open
  await page.getByRole('button').last().click();

  // Logout
  await page.getByText(/sign out/i).click();

  // Back to login
  await page.waitForURL(/login/, { timeout: 15000 });

  await expect(page).toHaveURL(/login/);
});

test('Dashboard loads', async ({ authedPage: page }) => {
  await page.goto('/app/dashboard');

  // URL verify
  await expect(page).toHaveURL(/dashboard/);

  // Dashboard heading verify
  await expect(
    page.getByRole('heading', { name: /Dashboard/i })
  ).toBeVisible();
});
test('Leads page loads', async ({ authedPage: page }) => {
  await page.goto('/app/leads');

  // Verify
  await expect(page).toHaveURL(/app\/leads/);
  await expect(page.getByRole('heading', { name: /Leads/i })).toBeVisible();
});
test('Customers page loads', async ({ authedPage: page }) => {
  await page.goto('/app/customers');

  // Verify
  await expect(page).toHaveURL(/app\/customers/);
  await expect(
    page.getByRole('heading', { name: /Customers/i })
  ).toBeVisible();
});
test('Deals page loads', async ({ authedPage: page }) => {
  await page.goto('/app/deals');

  // URL verify
  await expect(page).toHaveURL(/app\/deals/);

  // Heading verify
  await expect(
    page.getByRole('heading', { name: /Deal Pipeline/i })
  ).toBeVisible();
});
test('Tasks page loads', async ({ authedPage: page }) => {
  await page.goto('/app/tasks');

  // Verify URL
  await expect(page).toHaveURL(/app\/tasks/);

  // Verify heading
  await expect(
    page.getByRole('heading', { name: /Tasks & Reminders/i })
  ).toBeVisible();
});
test('Create new lead', async ({ authedPage: page }) => {
  await page.goto('/app/leads');

  await page.getByRole('button', { name: /new lead/i }).click();

  await page.locator('input[name="title"]').fill('Playwright Test Lead');

  await page.getByRole('button', { name: /create lead/i }).click();

  await expect(
  page.getByText(/Playwright Test Lead/i).first()
).toBeVisible();

  });
  test("Edit lead modal opens", async ({ authedPage: page }) => {
  await page.goto('/app/leads');

  // Wait until first 3-dot action button is visible
  const actionButton = page
    .locator("button")
    .filter({
      has: page.locator("svg.lucide-ellipsis-vertical"),
    })
    .first();

  await expect(actionButton).toBeVisible({ timeout: 10000 });

  // Open action menu
  await actionButton.click();

  // Wait for Edit option
  await expect(page.getByText(/^Edit$/)).toBeVisible({ timeout: 10000 });

  // Click Edit
  await page.getByText(/^Edit$/).click();

  // Verify Edit modal
  await expect(
    page.getByRole("heading", { name: /Edit lead/i })
  ).toBeVisible({ timeout: 10000 });

  // Verify Save button
  await expect(
    page.getByRole("button", { name: /^Save$/ })
  ).toBeVisible();

  // Verify Cancel button
  await expect(
    page.getByRole("button", { name: /^Cancel$/ })
  ).toBeVisible();
});
test("Edit lead successfully", async ({ authedPage: page }) => {
  await page.goto('/app/leads');

  // First lead menu
  const actionButton = page
    .locator("button")
    .filter({
      has: page.locator("svg.lucide-ellipsis-vertical"),
    })
    .first();

  await actionButton.click();

  await page.getByText(/^Edit$/).click();

  // Change title
  const titleInput = page.locator('input[name="title"]');

  await titleInput.fill("Updated Lead");

  await page.getByRole("button", { name: /^Save$/ }).click();

  // Verify updated lead appears
  await expect(
    page.getByText(/Updated Lead/i).first()
  ).toBeVisible();
});

test('Inspect Leads Page', async ({ authedPage: page }) => {
  await page.goto('/app/leads');

 
});
