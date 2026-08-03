/// <reference types="node" />
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  SecretCipher,
  encryptedSecretKeyId,
  maskSecretText,
  maskSensitiveValue,
} from '../../server/src/security/secrets.ts';
import {
  EnvironmentValidationError,
  parseEnvironment,
} from '../../server/src/config/environment.ts';

function encryptionKey() {
  return crypto.randomBytes(32).toString('base64url');
}

function strongSecret(label: string) {
  return `${label}-${crypto.randomBytes(32).toString('base64url')}`;
}

function productionEnvironment(overrides: Record<string, string> = {}) {
  const key = encryptionKey();
  return {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://crm.example.com',
    DATABASE_URL: 'postgresql://crm:K8!vQ2-zN7_xP4@db.internal:5432/crm?schema=public',
    JWT_ACCESS_SECRET: strongSecret('access'),
    JWT_REFRESH_SECRET: strongSecret('refresh'),
    COOKIE_SECRET: strongSecret('cookie'),
    ENCRYPTION_KEYS: `primary=${key}`,
    ENCRYPTION_CURRENT_KEY_ID: 'primary',
    AI_PROVIDER: 'mock',
    ...overrides,
  };
}

test.describe('Enterprise secrets and encryption', () => {
  test('uses authenticated AES-256 encryption and rotates old-key envelopes', () => {
    const oldKey = encryptionKey();
    const currentKey = encryptionKey();
    const oldCipher = SecretCipher.fromConfig({ keys: `old=${oldKey}`, currentKeyId: 'old' })!;
    const rotatingCipher = SecretCipher.fromConfig({
      keys: `current=${currentKey},old=${oldKey}`,
      currentKeyId: 'current',
    })!;

    const original = 'sk-live-phase-2-5-sensitive-value';
    const oldEnvelope = oldCipher.encrypt(original, 'OPENAI_API_KEY');
    expect(oldEnvelope).not.toContain(original);
    expect(encryptedSecretKeyId(oldEnvelope)).toBe('old');
    expect(rotatingCipher.decrypt(oldEnvelope, 'OPENAI_API_KEY')).toBe(original);

    const rotated = rotatingCipher.rotate(oldEnvelope, 'OPENAI_API_KEY');
    expect(encryptedSecretKeyId(rotated)).toBe('current');
    expect(rotatingCipher.decrypt(rotated, 'OPENAI_API_KEY')).toBe(original);
    expect(() => rotatingCipher.decrypt(rotated, 'DATABASE_URL')).toThrow(/authentication failed/i);

    const tamperedParts = rotated.split(':');
    tamperedParts[5] = `${tamperedParts[5][0] === 'A' ? 'B' : 'A'}${tamperedParts[5].slice(1)}`;
    const tampered = tamperedParts.join(':');
    expect(() => rotatingCipher.decrypt(tampered, 'OPENAI_API_KEY')).toThrow(/authentication failed/i);
  });

  test('decrypts protected database and API credentials during strict production validation', () => {
    const key = encryptionKey();
    const cipher = SecretCipher.fromConfig({ keys: `primary=${key}`, currentKeyId: 'primary' })!;
    const databaseUrl = 'postgresql://crm:T9!mR4-zQ8_xL6@db.internal:5432/crm?schema=public';
    const apiKey = 'sk-production-encrypted-provider-key';

    const env = parseEnvironment(productionEnvironment({
      DATABASE_URL: '',
      DATABASE_URL_ENCRYPTED: cipher.encrypt(databaseUrl, 'DATABASE_URL'),
      ENCRYPTION_KEYS: `primary=${key}`,
      OPENAI_API_KEY_ENCRYPTED: cipher.encrypt(apiKey, 'OPENAI_API_KEY'),
      AI_PROVIDER: 'openai',
    }));

    expect(env.DATABASE_URL).toBe(databaseUrl);
    expect(env.OPENAI_API_KEY).toBe(apiKey);
    expect(env.COOKIE_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.secretCipher?.currentKeyId).toBe('primary');
  });

  test('rejects weak or reused JWT secrets, missing cookie secrets, and unsafe database credentials', () => {
    expect(() => parseEnvironment(productionEnvironment({
      DATABASE_URL: 'postgresql://crm:crm_password@db.internal:5432/crm',
      JWT_ACCESS_SECRET: 'short',
      JWT_REFRESH_SECRET: 'short',
      COOKIE_SECRET: '',
    }))).toThrow(EnvironmentValidationError);

    try {
      parseEnvironment(productionEnvironment({
        DATABASE_URL: 'postgresql://crm:crm_password@db.internal:5432/crm',
        JWT_ACCESS_SECRET: 'short',
        JWT_REFRESH_SECRET: 'short',
        COOKIE_SECRET: '',
      }));
      throw new Error('Expected production validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      const message = (error as Error).message;
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('JWT_REFRESH_SECRET');
      expect(message).toContain('COOKIE_SECRET');
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain('crm_password');
    }
  });

  test('masks secrets in nested log data and API error responses', async ({ request }) => {
    const rawSecret = 'phase25-sensitive-api-key';
    const databaseUrl = 'postgresql://crm:NeverLogThisPassword@db.internal:5432/crm';
    const masked = maskSensitiveValue({
      apiKey: rawSecret,
      nested: { authorization: `Bearer ${rawSecret}`, error: databaseUrl },
    });
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain('NeverLogThisPassword');
    expect(maskSecretText(`request failed: ${databaseUrl}`)).not.toContain('NeverLogThisPassword');

    const response = await request.get(`/api/phase-2-5-missing?api_key=${rawSecret}`);
    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(rawSecret);
    expect(body).toContain('[REDACTED]');
  });
});
