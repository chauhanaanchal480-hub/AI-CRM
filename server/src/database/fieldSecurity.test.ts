import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptedSecretKeyId, SecretCipher, isEncryptedSecret } from '../security/secrets.js';
import { createFieldSecurity } from './fieldSecurity.js';

const key = Buffer.alloc(32, 7).toString('base64url');
const searchKey = Buffer.alloc(32, 11).toString('base64url');

test('sensitive database fields are encrypted and transparently decrypted', () => {
  const cipher = SecretCipher.fromConfig({ keys: `test=${key}`, currentKeyId: 'test' });
  const security = createFieldSecurity({ cipher, enabled: true, searchKey, developmentFallback: '' });
  const args = { data: { email: 'Private.User@example.com', phone: '+1 555 0100', name: 'Private User' } };
  security.encryptMutation('Customer', 'create', args);

  assert.equal(isEncryptedSecret(args.data.email), true);
  assert.equal(isEncryptedSecret(args.data.phone), true);
  assert.equal(args.data.name, 'Private User');
  const tokens = (args.data as typeof args.data & { emailSearchTokens?: string[] }).emailSearchTokens;
  assert.ok(Array.isArray(tokens));
  assert.ok(!tokens.join(',').includes('private'));

  const result = security.decryptResult({ id: '1', ...args.data }) as Record<string, unknown>;
  assert.equal(result.email, 'Private.User@example.com');
  assert.equal(result.phone, '+1 555 0100');
  assert.equal('emailSearchTokens' in result, false);

  const independentlyEncrypted = cipher?.encrypt('totp-seed', 'mfa:totp');
  const unrelated = security.decryptResult({ mfaSecretEncrypted: independentlyEncrypted }) as Record<string, unknown>;
  assert.equal(unrelated.mfaSecretEncrypted, independentlyEncrypted);
});

test('blind search tokens support encrypted case-insensitive substring lookup', () => {
  const security = createFieldSecurity({ cipher: null, enabled: false, searchKey, developmentFallback: '' });
  const indexed = new Set(security.searchTokens('Private.User@example.com'));
  for (const token of security.searchTokenQuery('USER@EXAMPLE')) assert.equal(indexed.has(token), true);
  assert.notDeepEqual(security.searchTokenQuery('user@example'), ['user@example']);
});

test('sensitive JSON audit metadata is authenticated at rest and restored as JSON', () => {
  const cipher = SecretCipher.fromConfig({ keys: `test=${key}`, currentKeyId: 'test' });
  const security = createFieldSecurity({ cipher, enabled: true, searchKey, developmentFallback: '' });
  const args = { data: { metadata: { method: 'PATCH', payload: { address: 'private' } } } };
  security.encryptMutation('AuditLog', 'create', args);
  assert.equal(typeof args.data.metadata, 'string');
  assert.equal(isEncryptedSecret(args.data.metadata as unknown as string), true);
  const result = security.decryptResult(args.data) as { metadata: unknown };
  assert.deepEqual(result.metadata, { method: 'PATCH', payload: { address: 'private' } });
});

test('mutations rotate sensitive strings and JSON from retired encryption keys', () => {
  const oldKey = Buffer.alloc(32, 3).toString('base64url');
  const newKey = Buffer.alloc(32, 5).toString('base64url');
  const oldCipher = SecretCipher.fromConfig({ keys: `old=${oldKey}`, currentKeyId: 'old' })!;
  const rotatingCipher = SecretCipher.fromConfig({ keys: `old=${oldKey},current=${newKey}`, currentKeyId: 'current' });
  const security = createFieldSecurity({ cipher: rotatingCipher, enabled: true, searchKey, developmentFallback: '' });
  const args = {
    data: {
      summary: oldCipher.encrypt('Private activity', 'database-field:summary'),
      metadata: oldCipher.encrypt(JSON.stringify({ private: true }), 'database-json-field:metadata'),
    },
  };

  security.encryptMutation('Activity', 'update', args);

  assert.equal(encryptedSecretKeyId(args.data.summary), 'current');
  assert.equal(encryptedSecretKeyId(args.data.metadata), 'current');
  assert.deepEqual(security.decryptResult(args.data), { summary: 'Private activity', metadata: { private: true } });
});
