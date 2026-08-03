import { test, expect, toast, uniqueName } from './helpers/fixtures';
import { createTask, deleteEntity } from './helpers/seed';

test.describe('Task CRUD', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/app/tasks');
    await expect(authedPage.getByRole('heading', { name: /tasks & reminders/i })).toBeVisible();
  });

  test('Quick-add creates a task in the To do column', async ({ authedPage: page, api }) => {
    const title = uniqueName('E2E Task');

    await page.getByPlaceholder(/add a task/i).fill(title);
    await page.locator('select').last().selectOption('HIGH');
    await page.getByRole('button', { name: /^Add$/ }).click();

    await toast(page, /task created/i);
    // Input clears after successful create
    await expect(page.getByPlaceholder(/add a task/i)).toHaveValue('');

    const card = page.locator('.card-surface', { hasText: title }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(/^HIGH$/)).toBeVisible();

    // Cleanup
    const res = await api.request.get('/api/tasks?limit=50&scope=mine', { headers: api.authHeaders });
    const { data } = (await res.json()) as { data: { id: string; title: string }[] };
    const created = data.find((t) => t.title === title);
    if (created) await deleteEntity(api.request, api.authHeaders, 'tasks', created.id);
  });

  test('Quick-add with Enter key submits', async ({ authedPage: page, api }) => {
    const title = uniqueName('Enter Task');

    await page.getByPlaceholder(/add a task/i).fill(title);
    await page.getByPlaceholder(/add a task/i).press('Enter');

    await toast(page, /task created/i);
    await expect(page.getByText(title).first()).toBeVisible();

    const res = await api.request.get('/api/tasks?limit=50&scope=mine', { headers: api.authHeaders });
    const { data } = (await res.json()) as { data: { id: string; title: string }[] };
    const created = data.find((t) => t.title === title);
    if (created) await deleteEntity(api.request, api.authHeaders, 'tasks', created.id);
  });

  test('Empty title is not submitted', async ({ authedPage: page, api }) => {
    const before = await api.request.get('/api/tasks?limit=1&scope=mine', { headers: api.authHeaders });
    const beforeMeta = (await before.json()) as { meta: { total: number } };

    await page.getByPlaceholder(/add a task/i).fill('   ');
    await page.getByRole('button', { name: /^Add$/ }).click();

    const after = await api.request.get('/api/tasks?limit=1&scope=mine', { headers: api.authHeaders });
    const afterMeta = (await after.json()) as { meta: { total: number } };
    expect(afterMeta.meta.total).toBe(beforeMeta.meta.total);
  });

  test('Cycle task status TODO → IN_PROGRESS → DONE', async ({ authedPage: page, api }) => {
    const title = uniqueName('Cycling Task');
    const task = await createTask(api.request, api.authHeaders, { title, priority: 'MEDIUM' });

    await page.reload();
    const cardInColumn = (columnName: RegExp) =>
      page
        .getByRole('heading', { name: columnName })
        .locator('..')
        .locator('..')
        .locator('.card-surface', { hasText: title });

    // TODO → IN_PROGRESS
    await cardInColumn(/^To do$/).getByTitle(/cycle status/i).click();
    await expect(cardInColumn(/^In progress$/)).toBeVisible();

    // IN_PROGRESS → DONE (title gets line-through styling)
    await cardInColumn(/^In progress$/).getByTitle(/cycle status/i).click();
    const doneCard = cardInColumn(/^Done$/);
    await expect(doneCard).toBeVisible();
    await expect(doneCard.getByText(title, { exact: true })).toHaveClass(/line-through/);

    await deleteEntity(api.request, api.authHeaders, 'tasks', task.id);
  });

  test('Delete task via hover trash button', async ({ authedPage: page, api }) => {
    const title = uniqueName('Trash Task');
    await createTask(api.request, api.authHeaders, { title, priority: 'LOW' });

    await page.reload();
    const card = page.locator('.card-surface', { hasText: title }).first();
    await expect(card).toBeVisible();

    await card.hover();
    await card.locator('button').last().click();

    await toast(page, /task deleted/i);
    await expect(page.locator('.card-surface', { hasText: title })).toHaveCount(0);
  });

  test('Tasks are grouped into three status columns', async ({ authedPage: page }) => {
    await expect(page.getByRole('heading', { name: /^To do$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^In progress$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Done$/ })).toBeVisible();
  });

  test('Admin can switch between My tasks and All tasks scope', async ({ authedPage: page }) => {
    const scopeSelect = page.locator('select').first();
    await expect(scopeSelect).toBeVisible();

    await scopeSelect.selectOption('all');
    await expect(page.getByRole('heading', { name: /^To do$/ })).toBeVisible();

    await scopeSelect.selectOption('mine');
    await expect(page.getByRole('heading', { name: /^To do$/ })).toBeVisible();
  });
});

test.describe('Task scope by role', () => {
  test.use({ role: 'employee' });

  test('Employee does not see the scope selector', async ({ authedPage: page }) => {
    await page.goto('/app/tasks');
    await expect(page.getByRole('heading', { name: /tasks & reminders/i })).toBeVisible();

    // The header select (My tasks / All tasks) is admin/manager only.
    // The only selects on the page belong to the quick-add priority control.
    const selects = page.locator('select');
    await expect(selects).toHaveCount(1);
  });
});
