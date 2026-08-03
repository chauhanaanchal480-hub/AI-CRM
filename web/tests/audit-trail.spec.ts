import type { APIRequestContext } from '@playwright/test';
import { test, expect, uniqueName } from './helpers/fixtures';
import { USERS } from './helpers/auth';

interface AuditLog {
  id: string;
  userId: string | null;
  sessionId: string | null;
  requestId: string;
  ip: string;
  userAgent: string;
  timestamp: string;
  resource: string;
  action: string;
  targetId: string | null;
  success: boolean;
  statusCode: number;
  metadata: Record<string, unknown> | null;
}

type AuthHeaders = { Authorization: string };

function auditRequestId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function loadAuditLogs(request: APIRequestContext, headers: AuthHeaders, query: Record<string, string>) {
  const params = new URLSearchParams({ limit: '100', ...query });
  const response = await request.get(`/api/audit?${params}`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    data: AuditLog[];
    meta: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  };
}

async function waitForAuditLogs(
  request: APIRequestContext,
  headers: AuthHeaders,
  requestId: string,
  count = 1,
) {
  await expect.poll(async () => {
    const result = await loadAuditLogs(request, headers, { requestId });
    return result.data.length;
  }, { timeout: 10_000 }).toBeGreaterThanOrEqual(count);
  return (await loadAuditLogs(request, headers, { requestId })).data;
}

test.describe('Enterprise audit trail', () => {
  test('records successful and failed logins with request/session context and masked credentials', async ({ request, api }) => {
    const successRequestId = auditRequestId('login-success');
    const success = await request.post('/api/auth/login', {
      headers: { 'X-Request-Id': successRequestId, 'User-Agent': 'audit-playwright/1.0' },
      data: { email: USERS.admin.email, password: USERS.admin.password },
    });
    expect(success.status()).toBe(200);
    expect(success.headers()['x-request-id']).toBe(successRequestId);

    const [loginLog] = await waitForAuditLogs(api.request, api.authHeaders, successRequestId);
    expect(loginLog).toMatchObject({
      requestId: successRequestId,
      resource: 'AUTH',
      action: 'LOGIN',
      success: true,
      statusCode: 200,
      userAgent: 'audit-playwright/1.0',
    });
    expect(loginLog.userId).toBeTruthy();
    expect(loginLog.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(loginLog.ip).toBeTruthy();
    expect(new Date(loginLog.timestamp).toString()).not.toBe('Invalid Date');
    expect(JSON.stringify(loginLog.metadata)).not.toContain(USERS.admin.password);
    expect(loginLog.metadata).toMatchObject({
      payload: { email: '[REDACTED]', password: '[REDACTED]' },
    });

    const failedRequestId = auditRequestId('login-failure');
    const failed = await request.post('/api/auth/login', {
      headers: { 'X-Request-Id': failedRequestId },
      data: { email: `missing-${Date.now()}@test.dev`, password: 'DefinitelyWrong123!' },
    });
    expect(failed.status()).toBe(401);

    const failedLogs = await waitForAuditLogs(api.request, api.authHeaders, failedRequestId, 2);
    expect(failedLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'AUTH', action: 'LOGIN', success: false, statusCode: 401 }),
      expect.objectContaining({ resource: 'SECURITY', action: 'FAILED_LOGIN', success: false, statusCode: 401 }),
    ]));
    expect(JSON.stringify(failedLogs)).not.toContain('DefinitelyWrong123!');
  });

  test('records User, Customer, Lead, Deal, and Task CRUD actions with target IDs', async ({ api }) => {
    const tracked: { requestId: string; resource: string; action: string; targetId?: string }[] = [];
    const headers = (requestId: string) => ({ ...api.authHeaders, 'X-Request-Id': requestId });

    const userListRequestId = auditRequestId('user-list');
    const usersResponse = await api.request.get('/api/users', { headers: headers(userListRequestId) });
    expect(usersResponse.status()).toBe(200);
    const users = (await usersResponse.json()) as { data: { email: string; title: string | null }[] };
    tracked.push({ requestId: userListRequestId, resource: 'USER', action: 'LIST' });

    const userUpdateRequestId = auditRequestId('user-update');
    expect((await api.request.patch('/api/users/me', {
      headers: headers(userUpdateRequestId),
      data: { title: users.data.find((user) => user.email === USERS.admin.email)?.title ?? '' },
    })).status()).toBe(200);
    tracked.push({ requestId: userUpdateRequestId, resource: 'USER', action: 'UPDATE' });

    const createCustomerRequestId = auditRequestId('customer-create');
    const customerResponse = await api.request.post('/api/customers', {
      headers: headers(createCustomerRequestId),
      data: { name: uniqueName('Audit Customer') },
    });
    expect(customerResponse.status()).toBe(201);
    const customer = ((await customerResponse.json()) as { data: { id: string } }).data;
    tracked.push({ requestId: createCustomerRequestId, resource: 'CUSTOMER', action: 'CREATE', targetId: customer.id });

    const createLeadRequestId = auditRequestId('lead-create');
    const leadResponse = await api.request.post('/api/leads', {
      headers: headers(createLeadRequestId),
      data: { title: uniqueName('Audit Lead') },
    });
    expect(leadResponse.status()).toBe(201);
    const lead = ((await leadResponse.json()) as { data: { id: string } }).data;
    tracked.push({ requestId: createLeadRequestId, resource: 'LEAD', action: 'CREATE', targetId: lead.id });

    const createTaskRequestId = auditRequestId('task-create');
    const taskResponse = await api.request.post('/api/tasks', {
      headers: headers(createTaskRequestId),
      data: { title: uniqueName('Audit Task'), priority: 'MEDIUM' },
    });
    expect(taskResponse.status()).toBe(201);
    const task = ((await taskResponse.json()) as { data: { id: string } }).data;
    tracked.push({ requestId: createTaskRequestId, resource: 'TASK', action: 'CREATE', targetId: task.id });

    const boardResponse = await api.request.get('/api/deals/board', { headers: api.authHeaders });
    const board = (await boardResponse.json()) as { data: { columns: { id: string }[] } };
    const createDealRequestId = auditRequestId('deal-create');
    const dealResponse = await api.request.post('/api/deals', {
      headers: headers(createDealRequestId),
      data: { title: uniqueName('Audit Deal'), customerId: customer.id, stageId: board.data.columns[0].id, value: 100 },
    });
    expect(dealResponse.status()).toBe(201);
    const deal = ((await dealResponse.json()) as { data: { id: string } }).data;
    tracked.push({ requestId: createDealRequestId, resource: 'DEAL', action: 'CREATE', targetId: deal.id });

    for (const [resource, path, id, update] of [
      ['CUSTOMER', 'customers', customer.id, { company: 'Audited Company' }],
      ['LEAD', 'leads', lead.id, { status: 'CONTACTED' }],
      ['DEAL', 'deals', deal.id, { probability: 55 }],
      ['TASK', 'tasks', task.id, { priority: 'HIGH' }],
    ] as const) {
      const readRequestId = auditRequestId(`${path}-read`);
      expect((await api.request.get(`/api/${path}/${id}`, { headers: headers(readRequestId) })).status()).toBe(200);
      tracked.push({ requestId: readRequestId, resource, action: 'READ', targetId: id });

      const updateRequestId = auditRequestId(`${path}-update`);
      expect((await api.request.patch(`/api/${path}/${id}`, { headers: headers(updateRequestId), data: update })).status()).toBe(200);
      tracked.push({ requestId: updateRequestId, resource, action: 'UPDATE', targetId: id });
    }

    for (const [resource, path, id] of [
      ['DEAL', 'deals', deal.id],
      ['LEAD', 'leads', lead.id],
      ['TASK', 'tasks', task.id],
      ['CUSTOMER', 'customers', customer.id],
    ] as const) {
      const deleteRequestId = auditRequestId(`${path}-delete`);
      expect((await api.request.delete(`/api/${path}/${id}`, { headers: headers(deleteRequestId) })).status()).toBe(200);
      tracked.push({ requestId: deleteRequestId, resource, action: 'DELETE', targetId: id });
    }

    for (const expected of tracked) {
      const [log] = await waitForAuditLogs(api.request, api.authHeaders, expected.requestId);
      expect(log).toMatchObject({
        requestId: expected.requestId,
        resource: expected.resource,
        action: expected.action,
        success: true,
        ...(expected.targetId ? { targetId: expected.targetId } : {}),
      });
      expect(log.userId).toBeTruthy();
      expect(log.sessionId).toBeTruthy();
    }
  });

  test('records file uploads, AI requests, logout, and security access failures', async ({ request, api, playwright }) => {
    const customerResponse = await api.request.get('/api/customers?limit=1', { headers: api.authHeaders });
    const customerId = ((await customerResponse.json()) as { data: { id: string }[] }).data[0].id;

    const aiRequestId = auditRequestId('ai-request');
    const aiResponse = await api.request.post(`/api/ai/customers/${customerId}/summarize`, {
      headers: { ...api.authHeaders, 'X-Request-Id': aiRequestId },
    });
    expect(aiResponse.ok()).toBeTruthy();

    const uploadRequestId = auditRequestId('file-upload');
    const uploadResponse = await api.request.post('/api/uploads', {
      headers: { ...api.authHeaders, 'X-Request-Id': uploadRequestId },
      multipart: {
        file: { name: 'audit-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('audit evidence') },
      },
    });
    expect(uploadResponse.status()).toBe(201);
    const attachment = ((await uploadResponse.json()) as { data: { id: string } }).data;

    const unauthorizedRequestId = auditRequestId('unauthorized');
    const unauthorized = await request.get('/api/customers', { headers: { 'X-Request-Id': unauthorizedRequestId } });
    expect(unauthorized.status()).toBe(401);

    const logoutContext = await playwright.request.newContext({ baseURL: 'http://localhost:5173' });
    const login = await logoutContext.post('/api/auth/login', {
      data: { email: USERS.employee.email, password: USERS.employee.password },
    });
    expect(login.status()).toBe(200);
    const logoutRequestId = auditRequestId('logout');
    const logout = await logoutContext.post('/api/auth/logout', { headers: { 'X-Request-Id': logoutRequestId } });
    expect(logout.status()).toBe(200);
    await logoutContext.dispose();

    expect(await waitForAuditLogs(api.request, api.authHeaders, aiRequestId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'AI', action: 'REQUEST', targetId: customerId, success: true }),
    ]));
    expect(await waitForAuditLogs(api.request, api.authHeaders, uploadRequestId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'FILE', action: 'UPLOAD', targetId: attachment.id, success: true }),
    ]));
    expect(await waitForAuditLogs(api.request, api.authHeaders, unauthorizedRequestId, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'CUSTOMER', action: 'LIST', success: false }),
      expect.objectContaining({ resource: 'SECURITY', action: 'UNAUTHORIZED_ACCESS', success: false }),
    ]));
    expect(await waitForAuditLogs(api.request, api.authHeaders, logoutRequestId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'AUTH', action: 'LOGOUT', success: true }),
    ]));

    await api.request.delete(`/api/uploads/${attachment.id}`, { headers: api.authHeaders });
  });

  test('supports admin filtering, pagination, and CSV export', async ({ api }) => {
    const firstRequestId = auditRequestId('filter-one');
    const secondRequestId = auditRequestId('filter-two');
    expect((await api.request.get('/api/customers?limit=1', {
      headers: { ...api.authHeaders, 'X-Request-Id': firstRequestId },
    })).status()).toBe(200);
    expect((await api.request.get('/api/customers?limit=1', {
      headers: { ...api.authHeaders, 'X-Request-Id': secondRequestId },
    })).status()).toBe(200);
    await waitForAuditLogs(api.request, api.authHeaders, secondRequestId);

    const filtered = await loadAuditLogs(api.request, api.authHeaders, {
      resource: 'customer',
      action: 'list',
      success: 'true',
      page: '1',
      limit: '1',
    });
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0]).toMatchObject({ resource: 'CUSTOMER', action: 'LIST', success: true });
    expect(filtered.meta).toMatchObject({ page: 1, limit: 1, hasPrev: false });
    expect(filtered.meta.total).toBeGreaterThanOrEqual(2);

    const csv = await api.request.get(`/api/audit/export?requestId=${firstRequestId}`, { headers: api.authHeaders });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toMatch(/attachment; filename="audit-logs-\d{4}-\d{2}-\d{2}\.csv"/);
    const content = await csv.text();
    expect(content).toContain('"Timestamp","Request ID","User ID","Session ID"');
    expect(content).toContain(firstRequestId);
    expect(content).toContain('"SUCCESS"');
  });
});
