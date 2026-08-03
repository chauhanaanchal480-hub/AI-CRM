import crypto from 'node:crypto';
import { test, expect, uniqueName } from './helpers/fixtures';

const hmacKeyId = process.env.PLAYWRIGHT_API_HMAC_KEY_ID!;
const hmacSecret = process.env.PLAYWRIGHT_API_HMAC_SECRET!;

function sha256(value: crypto.BinaryLike) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalTarget(target: string) {
  const url = new URL(target, 'http://api.local');
  const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyOrder = leftKey.localeCompare(rightKey);
    return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
  });
  const query = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

function signingHeaders(
  method: string,
  target: string,
  body: Buffer = Buffer.alloc(0),
  options: { timestamp?: number; nonce?: string; signature?: string; requestId?: string } = {},
) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? `phase27-${crypto.randomUUID()}`;
  const payload = [method.toUpperCase(), canonicalTarget(target), timestamp, nonce, sha256(body)].join('\n');
  const signature = options.signature ?? crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');
  return {
    'X-API-Key-Id': hmacKeyId,
    'X-API-Timestamp': timestamp,
    'X-API-Nonce': nonce,
    'X-API-Signature': signature,
    ...(options.requestId ? { 'X-Request-Id': options.requestId } : {}),
  };
}

function canonicalMultipartBody(
  file: { fieldName: string; filename: string; contentType: string; content: Buffer },
  fields: ReadonlyArray<readonly [string, string]> = [],
) {
  const sortedFields = [...fields].sort(([leftName, leftValue], [rightName, rightValue]) => {
    const nameOrder = leftName.localeCompare(rightName);
    return nameOrder === 0 ? leftValue.localeCompare(rightValue) : nameOrder;
  });
  return Buffer.from(JSON.stringify({
    fields: sortedFields,
    files: [{
      fieldName: file.fieldName,
      filename: file.filename,
      contentType: file.contentType,
      sha256: sha256(file.content),
    }],
  }), 'utf8');
}

test.describe('Enterprise API boundary', () => {
  test('serves canonical v1, deprecates the legacy alias, and rejects unknown versions', async ({ request }) => {
    const canonical = await request.get('/api/v1');
    expect(canonical.status()).toBe(200);
    expect(canonical.headers()['x-api-version']).toBe('1');
    expect(canonical.headers()['cache-control']).toContain('no-store');
    expect(canonical.headers()['x-content-type-options']).toBe('nosniff');

    const legacy = await request.get('/api');
    expect(legacy.status()).toBe(200);
    expect(legacy.headers()['deprecation']).toBe('true');
    expect(legacy.headers()['sunset']).toBe('Wed, 30 Jun 2027 00:00:00 GMT');
    expect(legacy.headers()['link']).toContain('</api/v1>');

    const unsupported = await request.get('/api/v2');
    expect(unsupported.status()).toBe(400);
    expect((await unsupported.json()).error.details.code).toBe('UNSUPPORTED_API_VERSION');
  });

  test('enforces JSON response negotiation and blocks method-override abuse', async ({ request }) => {
    const unacceptable = await request.get('/api/v1', { headers: { Accept: 'text/html' } });
    expect(unacceptable.status()).toBe(406);
    expect((await unacceptable.json()).error.details.code).toBe('JSON_RESPONSE_REQUIRED');

    const override = await request.get('/api/v1', { headers: { 'X-HTTP-Method-Override': 'DELETE' } });
    expect(override.status()).toBe(400);
    const body = await override.json();
    expect(body.error.details).toMatchObject({ code: 'API_ABUSE_DETECTED', reason: 'method_override' });
  });

  test('publishes the OpenAPI 3.1 contract and HMAC signing requirements', async ({ request }) => {
    const response = await request.get('/api/v1/openapi.json');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');

    const document = await response.json();
    expect(document.openapi).toBe('3.1.0');
    expect(document.servers).toContainEqual(expect.objectContaining({ url: '/api/v1' }));
    expect(document.paths['/customers'].post.parameters).toContainEqual({
      $ref: '#/components/parameters/IdempotencyKey',
    });
    expect(document.components.securitySchemes).toEqual(expect.objectContaining({
      bearerAuth: expect.objectContaining({ scheme: 'bearer' }),
      hmacSignature: expect.objectContaining({ name: 'X-API-Signature' }),
      hmacNonce: expect.objectContaining({ name: 'X-API-Nonce' }),
    }));
    expect(document.paths['/customers'].post.security).toContainEqual({
      bearerAuth: [],
      hmacKeyId: [],
      hmacSignature: [],
      hmacTimestamp: [],
      hmacNonce: [],
    });
    expect(document['x-hmac-signing'].algorithm).toBe('HMAC-SHA256');
  });

  test('rejects incomplete, malformed, and unknown HMAC signing credentials', async ({ request }) => {
    const incomplete = await request.get('/api/v1', { headers: { 'X-API-Key-Id': 'partner' } });
    expect(incomplete.status()).toBe(401);
    expect((await incomplete.json()).error.details.code).toBe('HMAC_HEADERS_INCOMPLETE');

    const malformed = await request.get('/api/v1', {
      headers: {
        'X-API-Key-Id': 'partner',
        'X-API-Timestamp': 'not-a-timestamp',
        'X-API-Nonce': 'too-short',
        'X-API-Signature': 'not-a-signature',
      },
    });
    expect(malformed.status()).toBe(401);
    expect((await malformed.json()).error.details.code).toBe('HMAC_HEADERS_INVALID');

    const unknown = await request.get('/api/v1', {
      headers: {
        'X-API-Key-Id': 'unknown-partner',
        'X-API-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-API-Nonce': `nonce-${Date.now()}-unique`,
        'X-API-Signature': '0'.repeat(64),
      },
    });
    expect(unknown.status()).toBe(401);
    expect((await unknown.json()).error.details.code).toBe('HMAC_KEY_UNKNOWN');
  });

  test('accepts valid signatures, exposes verification, and rejects an invalid signature', async ({ request }) => {
    const target = '/api/v1';
    const valid = await request.get(target, { headers: signingHeaders('GET', target) });
    expect(valid.status()).toBe(200);
    expect(valid.headers()['x-signature-verified']).toBe('true');

    const invalid = await request.get(target, {
      headers: signingHeaders('GET', target, Buffer.alloc(0), { signature: '0'.repeat(64) }),
    });
    expect(invalid.status()).toBe(401);
    expect((await invalid.json()).error.details.code).toBe('HMAC_SIGNATURE_INVALID');
    expect(invalid.headers()['x-signature-verified']).toBeUndefined();
  });

  test('rejects expired and future timestamps', async ({ request }) => {
    const target = '/api/v1';
    const now = Math.floor(Date.now() / 1000);
    const expired = await request.get(target, {
      headers: signingHeaders('GET', target, Buffer.alloc(0), { timestamp: now - 360 }),
    });
    expect(expired.status()).toBe(401);
    expect((await expired.json()).error.details.code).toBe('HMAC_TIMESTAMP_EXPIRED');

    const future = await request.get(target, {
      headers: signingHeaders('GET', target, Buffer.alloc(0), { timestamp: now + 360 }),
    });
    expect(future.status()).toBe(401);
    expect((await future.json()).error.details.code).toBe('HMAC_TIMESTAMP_EXPIRED');
  });

  test('blocks replay and persists successful and rejected signing audits', async ({ api }) => {
    const target = '/api/v1';
    const requestId = `phase27-audit-${crypto.randomUUID()}`;
    const headers = signingHeaders('GET', target, Buffer.alloc(0), { requestId });

    const first = await api.request.get(target, { headers });
    expect(first.status()).toBe(200);
    const replay = await api.request.get(target, { headers });
    expect(replay.status()).toBe(409);
    expect((await replay.json()).error.details.code).toBe('HMAC_REPLAY_DETECTED');

    const audit = await api.request.get(`/api/audit?requestId=${requestId}&limit=10`, { headers: api.authHeaders });
    expect(audit.status()).toBe(200);
    const actions = ((await audit.json()).data as Array<{ action: string; success: boolean }>)
      .map(({ action, success }) => ({ action, success }));
    expect(actions).toEqual(expect.arrayContaining([
      { action: 'API_SIGNATURE_VERIFIED', success: true },
      { action: 'API_SIGNATURE_REPLAY_REJECTED', success: false },
    ]));
  });

  test('canonicalizes sorted query parameters and the exact JSON body', async ({ request }) => {
    const queryTarget = '/api/v1?z=last&a=first&a=second';
    const query = await request.get(queryTarget, { headers: signingHeaders('GET', queryTarget) });
    expect(query.status()).toBe(200);
    expect(query.headers()['x-signature-verified']).toBe('true');

    const bodyTarget = '/api/v1/canonical-body';
    const body = { alpha: 'one', nested: { beta: 2 } };
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
    const bodyResponse = await request.post(bodyTarget, {
      headers: signingHeaders('POST', bodyTarget, rawBody),
      data: body,
    });
    expect(bodyResponse.status()).toBe(404);
    expect(bodyResponse.headers()['x-signature-verified']).toBe('true');
  });

  test('hashes multipart fields and file bytes and rejects tampered file content', async ({ api }) => {
    const target = '/api/v1/uploads';
    const file = {
      fieldName: 'file',
      filename: `phase27-${Date.now()}.txt`,
      contentType: 'text/plain',
      content: Buffer.from('signed multipart content\n', 'utf8'),
    };
    const canonicalBody = canonicalMultipartBody(file);
    const valid = await api.request.post(target, {
      headers: { ...api.authHeaders, ...signingHeaders('POST', target, canonicalBody) },
      multipart: {
        file: { name: file.filename, mimeType: file.contentType, buffer: file.content },
      },
    });
    expect(valid.status()).toBe(201);
    expect(valid.headers()['x-signature-verified']).toBe('true');
    const attachment = (await valid.json()).data as { id: string };

    const tampered = await api.request.post(target, {
      headers: { ...api.authHeaders, ...signingHeaders('POST', target, canonicalBody) },
      multipart: {
        file: {
          name: file.filename,
          mimeType: file.contentType,
          buffer: Buffer.from('tampered multipart content\n', 'utf8'),
        },
      },
    });
    expect(tampered.status()).toBe(401);
    expect((await tampered.json()).error.details.code).toBe('HMAC_SIGNATURE_INVALID');

    await api.request.delete(`/api/uploads/${attachment.id}`, { headers: api.authHeaders });
  });

  test('replays identical idempotent writes and rejects key reuse with a different payload', async ({ api }) => {
    const key = `task-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const firstTitle = uniqueName('Idempotent task');
    const headers = { ...api.authHeaders, 'Idempotency-Key': key };

    const first = await api.request.post('/api/v1/tasks', {
      headers,
      data: { title: firstTitle, priority: 'MEDIUM' },
    });
    expect(first.status()).toBe(201);
    expect(first.headers()['idempotency-key']).toBe(key);
    const firstBody = await first.json();

    const replay = await api.request.post('/api/v1/tasks', {
      headers,
      data: { title: firstTitle, priority: 'MEDIUM' },
    });
    expect(replay.status()).toBe(201);
    expect(replay.headers()['idempotency-replayed']).toBe('true');
    expect(await replay.json()).toEqual(firstBody);

    const conflict = await api.request.post('/api/v1/tasks', {
      headers,
      data: { title: uniqueName('Different task'), priority: 'HIGH' },
    });
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.details.code).toBe('IDEMPOTENCY_KEY_REUSED');

    await api.request.delete(`/api/tasks/${firstBody.data.id}`, { headers: api.authHeaders });
  });

  test('rejects unsafe cross-site requests before they reach application routes', async ({ request }) => {
    const response = await request.post('/api/v1/auth/login', {
      headers: { Origin: 'https://attacker.invalid' },
      data: { email: 'admin@crm.dev', password: 'Password123!' },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.details.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
  });
});
