import assert from 'node:assert/strict';
import test from 'node:test';
import { negotiateEncoding } from './compression.js';
import { decodeQueueValue, encodeQueueValue } from './queue.js';
import { deserialize, serialize } from './serialization.js';

test('compression negotiation honors q-values and prefers Brotli', () => {
  assert.equal(negotiateEncoding('gzip;q=0.8, br;q=1'), 'br');
  assert.equal(negotiateEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(negotiateEncoding('gzip;q=0, br;q=0'), null);
  assert.equal(negotiateEncoding(undefined), null);
});

test('queue envelopes round-trip dates without exposing plaintext assumptions', () => {
  const input = { createdAt: new Date('2026-08-07T00:00:00.000Z'), count: 3 };
  const envelope = encodeQueueValue(input);
  const output = decodeQueueValue<typeof input>(envelope);
  assert.deepEqual(output, input);
  assert.deepEqual(deserialize<typeof input>(serialize(input)), input);
});

test('queue decoder rejects malformed envelopes', () => {
  assert.throws(() => decodeQueueValue({ version: 2, encrypted: false, payload: '{}' } as never), /Invalid queue payload envelope/);
});
