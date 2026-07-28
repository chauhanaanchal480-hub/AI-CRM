import { test, expect, toast, uniqueName } from './helpers/fixtures';
import { createCustomer, deleteEntity } from './helpers/seed';

test.describe('AI assistant', () => {
  let customerId: string;

  test.beforeEach(async ({ authedPage: page, api }) => {
    const created = await createCustomer(api.request, api.authHeaders, {
      name: uniqueName('AI Customer'), company: 'AICo', email: 'ai@test.dev', status: 'ACTIVE',
    });
    customerId = created.id;
    await page.goto(`/app/customers/${customerId}`);
    await expect(page.getByText(/^AI Assistant$/)).toBeVisible();
  });

  test.afterEach(async ({ api }) => {
    await deleteEntity(api.request, api.authHeaders, 'customers', customerId);
  });

  test('AI card renders with empty-state prompts', async ({ authedPage: page }) => {
    await expect(page.getByText(/interaction summary/i)).toBeVisible();
    await expect(page.getByText(/generate an ai summary of this customer/i)).toBeVisible();
    await expect(page.getByText(/suggested follow-ups/i)).toBeVisible();
    await expect(page.getByText(/get ai-recommended next actions/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /summarize/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /suggest/i })).toBeVisible();
  });

  test('Generate interaction summary', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: /summarize/i }).click();

    await toast(page, /ai summary generated/i);
    // Summary text replaces the empty-state prompt; button label flips to Regenerate
    await expect(page.getByText(/generate an ai summary of this customer/i)).toBeHidden();
    await expect(page.getByRole('button', { name: /regenerate/i })).toBeVisible();
  });

  test('AI summary is recorded on the activity timeline', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: /summarize/i }).click();
    await toast(page, /ai summary generated/i);

    await expect(page.getByText(/ai generated an interaction summary/i)).toBeVisible();
  });

  test('Suggest follow-ups renders prioritised suggestions', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: /suggest/i }).click();

    // Each suggestion carries a priority badge and a title/reason pair
    const suggestion = page.locator('ul li').filter({ has: page.getByText(/^(LOW|MEDIUM|HIGH)$/) }).first();
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/get ai-recommended next actions/i)).toBeHidden();
  });

  test('Score lead via API returns score, rating and reason', async ({ api }) => {
    const leadRes = await api.request.post('/api/leads', {
      headers: api.authHeaders,
      data: { title: uniqueName('AI Score Lead'), status: 'CONTACTED', value: 30000, contactEmail: 'lead@test.dev' },
    });
    const lead = ((await leadRes.json()) as { data: { id: string } }).data;

    const res = await api.request.post(`/api/ai/leads/${lead.id}/score`, { headers: api.authHeaders });
    expect(res.ok()).toBeTruthy();
    const { data } = (await res.json()) as {
      data: { lead: { score: number; scoreRating: string; scoreReason: string }; provider: string };
    };

    expect(data.lead.score).toBeGreaterThanOrEqual(0);
    expect(data.lead.score).toBeLessThanOrEqual(100);
    expect(['COLD', 'WARM', 'HOT']).toContain(data.lead.scoreRating);
    expect(data.lead.scoreReason.length).toBeGreaterThan(0);

    await api.request.delete(`/api/leads/${lead.id}`, { headers: api.authHeaders });
  });

  test('Draft email endpoint returns subject and body', async ({ api }) => {
    const res = await api.request.post(`/api/ai/customers/${customerId}/draft-email`, {
      headers: api.authHeaders,
      data: { purpose: 'Follow up on the demo call', tone: 'FRIENDLY' },
    });
    expect(res.ok()).toBeTruthy();
    const { data } = (await res.json()) as { data: { draft: { subject: string; body: string } } };
    expect(data.draft.subject.length).toBeGreaterThan(0);
    expect(data.draft.body.length).toBeGreaterThan(0);
  });

  test('Meeting summary endpoint returns summary, key points and actions', async ({ api }) => {
    const res = await api.request.post(`/api/ai/customers/${customerId}/meeting-summary`, {
      headers: api.authHeaders,
      data: {
        transcript: 'We discussed pricing. Customer wants enterprise tier. Follow up next week with a proposal.',
        save: false,
      },
    });
    expect(res.ok()).toBeTruthy();
    const { data } = (await res.json()) as {
      data: { summary: string; keyPoints: string[]; actionItems: string[] };
    };
    expect(data.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(data.keyPoints)).toBeTruthy();
    expect(Array.isArray(data.actionItems)).toBeTruthy();
  });

  test('AI endpoints 404 for unknown customer', async ({ api }) => {
    const res = await api.request.post('/api/ai/customers/c000000000000000000000000/summarize', { headers: api.authHeaders });
    expect(res.status()).toBe(404);
  });
});
