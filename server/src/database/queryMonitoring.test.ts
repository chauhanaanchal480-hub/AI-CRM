import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryMonitor } from './queryMonitoring.js';

test('query monitoring aggregates parameter-free fingerprints and durations', () => {
  const monitor = createQueryMonitor({ slowMs: 100, sampleRate: 0 });
  monitor.onQuery({
    timestamp: new Date(),
    query: 'SELECT "id" FROM "Customer" WHERE "email" = $1',
    params: '["private@example.com"]',
    duration: 12,
    target: 'postgresql',
  });
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0]?.count, 1);
  assert.equal(snapshot[0]?.averageDurationMs, 12);
  assert.equal(JSON.stringify(snapshot).includes('private@example.com'), false);
});
