const keyIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

function booleanSetting(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function positiveIntegerSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function signingKeys() {
  const keys = new Map<string, Buffer>();
  const production = process.env.NODE_ENV === 'production';
  for (const entry of (process.env.API_HMAC_KEYS ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf('=');
    if (separator <= 0) throw new Error('API_HMAC_KEYS must use key-id=secret entries');
    const keyId = entry.slice(0, separator).trim();
    const secret = entry.slice(separator + 1);
    if (!keyIdPattern.test(keyId)) throw new Error(`API_HMAC_KEYS contains invalid key ID ${keyId}`);
    if (keys.has(keyId)) throw new Error(`API_HMAC_KEYS contains duplicate key ID ${keyId}`);
    const minimumBytes = production ? 32 : 16;
    if (Buffer.byteLength(secret, 'utf8') < minimumBytes) {
      throw new Error(`API HMAC key ${keyId} must contain at least ${minimumBytes} bytes`);
    }
    keys.set(keyId, Buffer.from(secret, 'utf8'));
  }
  return keys;
}

const hmacKeys = signingKeys();
const hmacRequired = booleanSetting('API_HMAC_REQUIRED', false);
if (hmacRequired && hmacKeys.size === 0) {
  throw new Error('API_HMAC_REQUIRED requires at least one API_HMAC_KEYS entry');
}

export const apiSecurityConfig = {
  hmacKeys,
  hmacRequired,
  hmacClockSkewSeconds: positiveIntegerSetting('API_HMAC_CLOCK_SKEW_SECONDS', 300, 30, 900),
  idempotencyTtlHours: positiveIntegerSetting('API_IDEMPOTENCY_TTL_HOURS', 24, 1, 168),
  abuseWindowMs: positiveIntegerSetting('API_ABUSE_WINDOW_MS', 5 * 60_000, 10_000, 60 * 60_000),
  abuseStrikeLimit: positiveIntegerSetting('API_ABUSE_STRIKE_LIMIT', 100, 10, 10_000),
  docsEnabled: booleanSetting('API_DOCS_ENABLED', process.env.NODE_ENV !== 'production'),
};
