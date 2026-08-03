import crypto from 'node:crypto';

const ENVELOPE_PREFIX = 'enc:v1';
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /(?:password|passcode|token|secret|authorization|cookie|api[-_]?key|database(?:_url)?|encryption[-_]?keys?|private[-_]?key|credential)/i;
const registeredSecrets = new Set<string>();

function decodeEncryptionKey(encoded: string): Buffer {
  const value = encoded.trim();
  if (!value) throw new Error('Encryption key cannot be empty');
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error('Encryption keys must decode to exactly 32 bytes');
  return key;
}

export interface SecretKeyringConfig {
  keys?: string;
  currentKeyId?: string;
}

export class SecretCipher {
  private constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    readonly currentKeyId: string,
  ) {}

  static fromConfig(config: SecretKeyringConfig): SecretCipher | null {
    const serialized = config.keys?.trim() ?? '';
    const currentKeyId = config.currentKeyId?.trim() ?? '';
    if (!serialized && !currentKeyId) return null;
    if (!serialized || !currentKeyId) {
      throw new Error('ENCRYPTION_KEYS and ENCRYPTION_CURRENT_KEY_ID must be configured together');
    }
    if (!KEY_ID_PATTERN.test(currentKeyId)) throw new Error('ENCRYPTION_CURRENT_KEY_ID is invalid');

    const keys = new Map<string, Buffer>();
    for (const entry of serialized.split(',')) {
      const separator = entry.indexOf('=');
      if (separator <= 0) throw new Error('ENCRYPTION_KEYS must use key-id=base64url-key entries');
      const keyId = entry.slice(0, separator).trim();
      const encoded = entry.slice(separator + 1).trim();
      if (!KEY_ID_PATTERN.test(keyId)) throw new Error('ENCRYPTION_KEYS contains an invalid key ID');
      if (keys.has(keyId)) throw new Error(`ENCRYPTION_KEYS contains duplicate key ID ${keyId}`);
      keys.set(keyId, decodeEncryptionKey(encoded));
    }
    if (!keys.has(currentKeyId)) throw new Error('ENCRYPTION_CURRENT_KEY_ID is not present in ENCRYPTION_KEYS');
    return new SecretCipher(keys, currentKeyId);
  }

  encrypt(plaintext: string, context = ''): string {
    const key = this.keys.get(this.currentKeyId);
    if (!key) throw new Error('Current encryption key is unavailable');
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(`${ENVELOPE_PREFIX}:${this.currentKeyId}:${context}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ENVELOPE_PREFIX,
      this.currentKeyId,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(envelope: string, context = ''): string {
    const parts = envelope.split(':');
    if (parts.length !== 6 || `${parts[0]}:${parts[1]}` !== ENVELOPE_PREFIX) {
      throw new Error('Encrypted secret envelope is invalid');
    }
    const [, , keyId, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Encryption key ${keyId} is unavailable`);

    try {
      const iv = Buffer.from(ivEncoded, 'base64url');
      const tag = Buffer.from(tagEncoded, 'base64url');
      const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Invalid envelope');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(`${ENVELOPE_PREFIX}:${keyId}:${context}`, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Encrypted secret authentication failed');
    }
  }

  rotate(envelope: string, context = ''): string {
    const keyId = encryptedSecretKeyId(envelope);
    if (keyId === this.currentKeyId) return envelope;
    return this.encrypt(this.decrypt(envelope, context), context);
  }
}

export function isEncryptedSecret(value: string | undefined): boolean {
  return value?.startsWith(`${ENVELOPE_PREFIX}:`) ?? false;
}

export function encryptedSecretKeyId(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 6 || `${parts[0]}:${parts[1]}` !== ENVELOPE_PREFIX || !KEY_ID_PATTERN.test(parts[2])) {
    throw new Error('Encrypted secret envelope is invalid');
  }
  return parts[2];
}

export function registerSecretValues(values: readonly (string | undefined)[]) {
  for (const value of values) {
    if (value && value.length >= 6) registeredSecrets.add(value);
  }
}

export function maskSecretText(value: string): string {
  let masked = value;
  for (const secret of registeredSecrets) masked = masked.split(secret).join(REDACTED);
  return masked
    .replace(/enc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*/g, REDACTED)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, `$1 ${REDACTED}`)
    .replace(/((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/@]+:)[^\s@/]+(@)/gi, `$1${REDACTED}$2`)
    .replace(/([?&](?:api[-_]?key|token|secret|password|credential)=)[^&#\s]*/gi, `$1${REDACTED}`)
    .replace(/((?:api[-_]?key|token|secret|password|credential)\s*[:=]\s*)[^,;\s]+/gi, `$1${REDACTED}`);
}

export function maskSensitiveValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskSecretText(value);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return maskSecretText(String(value));
  if (depth >= 8 || seen.has(value)) return '[TRUNCATED]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskSecretText(value.message),
      stack: value.stack ? maskSecretText(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => maskSensitiveValue(item, depth + 1, seen));

  const masked: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    masked[key] = SENSITIVE_KEY.test(key) ? REDACTED : maskSensitiveValue(item, depth + 1, seen);
  }
  return masked;
}
