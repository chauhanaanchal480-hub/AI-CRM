import { test, expect } from './helpers/fixtures';

interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

test.describe('Enterprise file upload security', () => {
  test('rejects an invalid extension', async ({ api }) => {
    const response = await api.request.post('/api/uploads', {
      headers: api.authHeaders,
      multipart: { file: { name: 'archive.xyz', mimeType: 'application/octet-stream', buffer: Buffer.from('data') } },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects a double extension', async ({ api }) => {
    const response = await api.request.post('/api/uploads', {
      headers: api.authHeaders,
      multipart: { file: { name: 'invoice.pdf.txt', mimeType: 'text/plain', buffer: Buffer.from('invoice') } },
    });

    expect(response.status()).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/double.*extension/i);
  });

  test('rejects a MIME type that does not match the extension', async ({ api }) => {
    const response = await api.request.post('/api/uploads', {
      headers: api.authHeaders,
      multipart: { file: { name: 'invoice.pdf', mimeType: 'text/plain', buffer: Buffer.from('invoice') } },
    });

    expect(response.status()).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/extension.*declared type/i);
  });

  test('rejects content with an invalid magic-byte signature', async ({ api }) => {
    const response = await api.request.post('/api/uploads', {
      headers: api.authHeaders,
      multipart: { file: { name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('not a png') } },
    });

    expect(response.status()).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/content.*declared type/i);
  });

  test('rejects an oversized file', async ({ api }) => {
    const response = await api.request.post('/api/uploads', {
      headers: api.authHeaders,
      multipart: {
        file: { name: 'oversized.txt', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x61) },
      },
      timeout: 60_000,
    });

    expect(response.status()).toBe(413);
  });

  test('rejects an executable upload', async ({ api }) => {
    const executable: UploadFile = {
      name: 'payload.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    };
    const response = await api.request.post('/api/uploads', {
      headers: api.authHeaders,
      multipart: { file: executable },
    });

    expect(response.status()).toBe(400);
  });

  test('sanitizes the display filename and generates a safe unique server filename', async ({ api }) => {
    const response = await api.request.post('/api/uploads', {
      headers: api.authHeaders,
      multipart: {
        file: { name: 'unsafe<script>.txt', mimeType: 'text/plain', buffer: Buffer.from('safe text content') },
      },
    });

    expect(response.status()).toBe(201);
    const body = (await response.json()) as {
      data: { id: string; filename: string; originalName: string; mimeType: string; url: string };
    };
    expect(body.data.originalName).toBe('unsafe_script_.txt');
    expect(body.data.filename).toMatch(/^[a-f0-9]{32}\.txt$/);
    expect(body.data.filename).not.toContain('unsafe');
    expect(body.data.mimeType).toBe('text/plain');
    expect(body.data.url).toBe(`/uploads/${body.data.filename}`);

    await api.request.delete(`/api/uploads/${body.data.id}`, { headers: api.authHeaders });
  });
});
