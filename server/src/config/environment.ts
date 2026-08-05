import { z } from 'zod';
import { SecretCipher, isEncryptedSecret, registerSecretValues } from '../security/secrets.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const positiveInteger = z.coerce.number().int().positive();
const duration = z.string().regex(/^\d+[smhd]$/, 'Must be a duration such as 15m, 12h, or 7d');
const optionalSecret = z.string().trim().optional().default('');
const nonNegativeInteger = z.coerce.number().int().nonnegative();
const forbiddenSecret = /(?:change[_-]?me|replace[_-]?me|default|example|password|secret123|crm_password)/i;

const rawEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  DATABASE_URL: optionalSecret,
  DATABASE_URL_ENCRYPTED: optionalSecret,
  ENCRYPTION_KEYS: optionalSecret,
  ENCRYPTION_CURRENT_KEY_ID: optionalSecret,
  FIELD_ENCRYPTION_ENABLED: booleanString.default('true'),
  FIELD_SEARCH_KEY: optionalSecret,

  DB_QUERY_SLOW_MS: positiveInteger.default(750),
  DB_QUERY_LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.01),

  DATA_RETENTION_ENABLED: booleanString.default('true'),
  RETENTION_DATABASE_URL: optionalSecret,
  DATA_RETENTION_INTERVAL_HOURS: positiveInteger.default(24),
  SOFT_DELETE_RETENTION_DAYS: nonNegativeInteger.default(30),
  AUDIT_RETENTION_DAYS: positiveInteger.default(2555),
  AUTH_RETENTION_DAYS: positiveInteger.default(730),
  RETENTION_RUN_RETENTION_DAYS: positiveInteger.default(365),

  JWT_ACCESS_SECRET: optionalSecret,
  JWT_REFRESH_SECRET: optionalSecret,
  COOKIE_SECRET: optionalSecret,
  JWT_ACCESS_TTL: duration.default('15m'),
  JWT_REFRESH_TTL: duration.default('7d'),
  SESSION_IDLE_TTL: duration.default('30m'),
  SESSION_ABSOLUTE_TTL: duration.default('30d'),

  RATE_LIMIT_ENABLED: booleanString.default('true'),
  RATE_LIMIT_MAX_KEYS: positiveInteger.default(50_000),
  RATE_LIMIT_GLOBAL_MAX: positiveInteger.default(20_000),
  RATE_LIMIT_GLOBAL_WINDOW_MS: positiveInteger.default(60_000),
  RATE_LIMIT_IP_MAX: positiveInteger.default(1_000),
  RATE_LIMIT_IP_WINDOW_MS: positiveInteger.default(15 * 60_000),
  RATE_LIMIT_USER_MAX: positiveInteger.default(2_000),
  RATE_LIMIT_USER_WINDOW_MS: positiveInteger.default(15 * 60_000),
  RATE_LIMIT_LOGIN_MAX: positiveInteger.default(50),
  RATE_LIMIT_LOGIN_WINDOW_MS: positiveInteger.default(15 * 60_000),
  RATE_LIMIT_PASSWORD_RESET_MAX: positiveInteger.default(10),
  RATE_LIMIT_PASSWORD_RESET_WINDOW_MS: positiveInteger.default(60 * 60_000),
  RATE_LIMIT_AI_MAX: positiveInteger.default(100),
  RATE_LIMIT_AI_WINDOW_MS: positiveInteger.default(60 * 60_000),
  RATE_LIMIT_UPLOAD_MAX: positiveInteger.default(100),
  RATE_LIMIT_UPLOAD_WINDOW_MS: positiveInteger.default(60 * 60_000),
  RATE_LIMIT_EXPORT_MAX: positiveInteger.default(30),
  RATE_LIMIT_EXPORT_WINDOW_MS: positiveInteger.default(60 * 60_000),

  UPLOAD_DIR: z.string().trim().min(1).default('uploads'),
  MAX_UPLOAD_MB: positiveInteger.default(10),

  AI_PROVIDER: z.enum(['mock', 'anthropic', 'openai', 'gemini']).default('mock'),
  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_API_KEY_ENCRYPTED: optionalSecret,
  ANTHROPIC_MODEL: z.string().trim().min(1).max(200).default('claude-opus-4-8'),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_API_KEY_ENCRYPTED: optionalSecret,
  OPENAI_MODEL: z.string().trim().min(1).max(200).default('gpt-4o-mini'),
  GEMINI_API_KEY: optionalSecret,
  GEMINI_API_KEY_ENCRYPTED: optionalSecret,
  GEMINI_MODEL: z.string().trim().min(1).max(200).default('gemini-2.5-flash'),
}).passthrough();

export class EnvironmentValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join('; ')}`);
    this.name = 'EnvironmentValidationError';
  }
}

function decryptConfiguredSecret(
  name: string,
  plaintext: string,
  encrypted: string,
  cipher: SecretCipher | null,
): string {
  if (!encrypted) return plaintext;
  if (!isEncryptedSecret(encrypted)) {
    throw new EnvironmentValidationError([`${name}_ENCRYPTED is not a valid encrypted envelope`]);
  }
  if (!cipher) throw new EnvironmentValidationError([`${name}_ENCRYPTED requires ENCRYPTION_KEYS`]);
  try {
    return cipher.decrypt(encrypted, name);
  } catch (error) {
    throw new EnvironmentValidationError([
      `${name}_ENCRYPTED could not be decrypted (${error instanceof Error ? error.message : 'unknown error'})`,
    ]);
  }
}

function secretStrengthIssue(name: string, value: string, production: boolean): string | null {
  const minimum = production ? 32 : 16;
  if (Buffer.byteLength(value, 'utf8') < minimum) return `${name} must contain at least ${minimum} bytes`;
  if (production && forbiddenSecret.test(value)) return `${name} contains a prohibited placeholder or common secret`;
  if (production && new Set(value).size < 12) return `${name} does not contain enough character diversity`;
  return null;
}

function encryptionKeyIssue(name: string, value: string): string | null {
  if (!value) return `${name} is required`;
  const decoded = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64url');
  return decoded.length === 32 ? null : `${name} must decode to exactly 32 bytes`;
}

function validateDatabaseUrl(value: string, production: boolean): string[] {
  if (!value) return ['DATABASE_URL is required'];
  try {
    const url = new URL(value);
    const issues: string[] = [];
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) issues.push('DATABASE_URL must use PostgreSQL');
    if (!url.hostname) issues.push('DATABASE_URL must include a hostname');
    if (!url.username) issues.push('DATABASE_URL must include a username');
    if (!url.password) issues.push('DATABASE_URL must include a password');
    if (production && forbiddenSecret.test(decodeURIComponent(url.password))) {
      issues.push('DATABASE_URL contains a prohibited placeholder or common password');
    }
    return issues;
  } catch {
    return ['DATABASE_URL must be a valid PostgreSQL connection URL'];
  }
}

function validateCorsOrigins(value: string): string[] {
  const issues: string[] = [];
  for (const origin of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
        issues.push(`CORS_ORIGIN contains invalid origin ${origin}`);
      }
    } catch {
      issues.push(`CORS_ORIGIN contains invalid origin ${origin}`);
    }
  }
  return issues;
}

export function parseEnvironment(input: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const parsed = rawEnvironmentSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`);
    throw new EnvironmentValidationError(issues);
  }

  const raw = parsed.data;
  let cipher: SecretCipher | null;
  try {
    cipher = SecretCipher.fromConfig({
      keys: raw.ENCRYPTION_KEYS,
      currentKeyId: raw.ENCRYPTION_CURRENT_KEY_ID,
    });
  } catch (error) {
    throw new EnvironmentValidationError([error instanceof Error ? error.message : 'Encryption configuration is invalid']);
  }

  const databaseUrl = decryptConfiguredSecret('DATABASE_URL', raw.DATABASE_URL, raw.DATABASE_URL_ENCRYPTED, cipher);
  const anthropicApiKey = decryptConfiguredSecret('ANTHROPIC_API_KEY', raw.ANTHROPIC_API_KEY, raw.ANTHROPIC_API_KEY_ENCRYPTED, cipher);
  const openAiApiKey = decryptConfiguredSecret('OPENAI_API_KEY', raw.OPENAI_API_KEY, raw.OPENAI_API_KEY_ENCRYPTED, cipher);
  const geminiApiKey = decryptConfiguredSecret('GEMINI_API_KEY', raw.GEMINI_API_KEY, raw.GEMINI_API_KEY_ENCRYPTED, cipher);
  const production = raw.NODE_ENV === 'production';
  const cookieSecret = raw.COOKIE_SECRET || (production ? '' : 'development-cookie-secret-change-me');

  const issues = [
    ...validateDatabaseUrl(databaseUrl, production),
    ...validateCorsOrigins(raw.CORS_ORIGIN),
    secretStrengthIssue('JWT_ACCESS_SECRET', raw.JWT_ACCESS_SECRET, production),
    secretStrengthIssue('JWT_REFRESH_SECRET', raw.JWT_REFRESH_SECRET, production),
    secretStrengthIssue('COOKIE_SECRET', cookieSecret, production),
  ].filter((issue): issue is string => Boolean(issue));

  if (raw.JWT_ACCESS_SECRET && raw.JWT_ACCESS_SECRET === raw.JWT_REFRESH_SECRET) {
    issues.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (cookieSecret && [raw.JWT_ACCESS_SECRET, raw.JWT_REFRESH_SECRET].includes(cookieSecret)) {
    issues.push('COOKIE_SECRET must be different from JWT secrets');
  }
  if (production && !cipher) issues.push('ENCRYPTION_KEYS and ENCRYPTION_CURRENT_KEY_ID are required in production');
  if (production && !raw.FIELD_ENCRYPTION_ENABLED) issues.push('FIELD_ENCRYPTION_ENABLED must be true in production');
  if (production) {
    const fieldSearchIssue = secretStrengthIssue('FIELD_SEARCH_KEY', raw.FIELD_SEARCH_KEY, true);
    if (fieldSearchIssue) issues.push(fieldSearchIssue);
    const fieldSearchKeyIssue = encryptionKeyIssue('FIELD_SEARCH_KEY', raw.FIELD_SEARCH_KEY);
    if (fieldSearchKeyIssue) issues.push(fieldSearchKeyIssue);
    if ([raw.JWT_ACCESS_SECRET, raw.JWT_REFRESH_SECRET, cookieSecret].includes(raw.FIELD_SEARCH_KEY)
      || raw.ENCRYPTION_KEYS.split(',').some((entry) => entry.slice(entry.indexOf('=') + 1).trim() === raw.FIELD_SEARCH_KEY)) {
      issues.push('FIELD_SEARCH_KEY must be dedicated and different from all encryption and authentication keys');
    }
    try {
      const databaseUser = decodeURIComponent(new URL(databaseUrl).username);
      if (['postgres', 'root', 'admin'].includes(databaseUser.toLowerCase())) {
        issues.push('DATABASE_URL must use a least-privilege application role in production');
      }
      const sslMode = new URL(databaseUrl).searchParams.get('sslmode');
      if (!['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')) {
        issues.push('DATABASE_URL must enforce TLS with sslmode=require, verify-ca, or verify-full in production');
      }
    } catch {
      // The URL validation above reports malformed database URLs.
    }
    if (raw.DATA_RETENTION_ENABLED) {
      if (!raw.RETENTION_DATABASE_URL) issues.push('RETENTION_DATABASE_URL is required when data retention is enabled in production');
      else {
        issues.push(...validateDatabaseUrl(raw.RETENTION_DATABASE_URL, true).map((issue) => issue.replace('DATABASE_URL', 'RETENTION_DATABASE_URL')));
        try {
          const appUrl = new URL(databaseUrl);
          const retentionUrl = new URL(raw.RETENTION_DATABASE_URL);
          if (decodeURIComponent(appUrl.username) === decodeURIComponent(retentionUrl.username)) {
            issues.push('RETENTION_DATABASE_URL must use a separate maintenance role');
          }
          const sslMode = retentionUrl.searchParams.get('sslmode');
          if (!['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')) {
            issues.push('RETENTION_DATABASE_URL must enforce TLS in production');
          }
        } catch {
          // URL validation reports malformed retention database URLs.
        }
      }
    }
  }

  const providerKeys = {
    anthropic: anthropicApiKey,
    openai: openAiApiKey,
    gemini: geminiApiKey,
  } as const;
  if (raw.AI_PROVIDER !== 'mock' && !providerKeys[raw.AI_PROVIDER]) {
    issues.push(`${raw.AI_PROVIDER.toUpperCase()} API key is required when that AI provider is selected`);
  }
  if (issues.length > 0) throw new EnvironmentValidationError(issues);

  registerSecretValues([
    raw.ENCRYPTION_KEYS,
    raw.FIELD_SEARCH_KEY,
    raw.JWT_ACCESS_SECRET,
    raw.JWT_REFRESH_SECRET,
    cookieSecret,
    databaseUrl,
    raw.RETENTION_DATABASE_URL,
    anthropicApiKey,
    openAiApiKey,
    geminiApiKey,
  ]);

  return {
    ...raw,
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: raw.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: raw.JWT_REFRESH_SECRET,
    COOKIE_SECRET: cookieSecret,
    ANTHROPIC_API_KEY: anthropicApiKey,
    OPENAI_API_KEY: openAiApiKey,
    GEMINI_API_KEY: geminiApiKey,
    secretCipher: cipher,
  };
}

export type Environment = ReturnType<typeof parseEnvironment>;
