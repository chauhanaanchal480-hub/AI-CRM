import crypto from 'node:crypto';
import type { SecretCipher } from '../security/secrets.js';
import { isEncryptedSecret } from '../security/secrets.js';

export const encryptedFieldsByModel = {
  User: ['phone'],
  Customer: ['email', 'phone', 'address', 'notes'],
  Lead: ['contactEmail', 'contactPhone', 'scoreReason'],
  Task: ['description'],
  Activity: ['summary'],
  Note: ['body'],
  EmailLog: ['subject', 'body', 'fromAddr', 'toAddr'],
  Attachment: ['originalName'],
  Notification: ['title', 'body'],
  AiInsight: ['content'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const encryptedJsonFieldsByModel = {
  AuditLog: ['metadata'],
  Activity: ['metadata'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const internalFields = new Set(['emailSearchTokens', 'contactEmailSearchTokens']);
const encryptedFieldNames = new Set<string>(Object.values(encryptedFieldsByModel).flat());
const encryptedJsonFieldNames = new Set<string>(Object.values(encryptedJsonFieldsByModel).flat());
const MAX_INDEXED_VALUE_LENGTH = 320;

function normalizeSearchValue(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').slice(0, MAX_INDEXED_VALUE_LENGTH);
}

function decodeSearchKey(configured: string, developmentFallback: string): Buffer {
  const source = configured.trim();
  if (!source) return crypto.createHash('sha256').update(developmentFallback).digest();
  const decoded = /^[a-f0-9]{64}$/i.test(source)
    ? Buffer.from(source, 'hex')
    : Buffer.from(source, 'base64url');
  if (decoded.length !== 32) throw new Error('FIELD_SEARCH_KEY must decode to exactly 32 bytes');
  return decoded;
}

export interface FieldSecurity {
  decryptResult(value: unknown): unknown;
  encryptMutation(model: string | undefined, action: string, args: unknown): void;
  searchTokens(value: string): string[];
  searchTokenQuery(value: string): string[];
}

export function createFieldSecurity(options: {
  cipher: SecretCipher | null;
  enabled: boolean;
  searchKey: string;
  developmentFallback: string;
}): FieldSecurity {
  const key = decodeSearchKey(options.searchKey, options.developmentFallback);

  const token = (value: string) => crypto
    .createHmac('sha256', key)
    .update(`field-search:v1:${value}`)
    .digest('base64url');

  const searchTokenQuery = (value: string): string[] => {
    const normalized = normalizeSearchValue(value);
    if (!normalized) return [];
    if (normalized.length <= 3) return [token(normalized)];
    return [...new Set(Array.from({ length: normalized.length - 2 }, (_, index) => token(normalized.slice(index, index + 3))))];
  };

  const searchTokens = (value: string): string[] => {
    const normalized = normalizeSearchValue(value);
    const pieces = new Set<string>();
    for (let size = 1; size <= Math.min(3, normalized.length); size += 1) {
      for (let index = 0; index <= normalized.length - size; index += 1) {
        pieces.add(normalized.slice(index, index + size));
      }
    }
    return [...pieces].map(token);
  };

  const encryptValue = (field: string, value: unknown): unknown => {
    if (!options.enabled || !options.cipher || typeof value !== 'string') return value;
    if (isEncryptedSecret(value)) return options.cipher.rotate(value, `database-field:${field}`);
    return options.cipher.encrypt(value, `database-field:${field}`);
  };

  const transformData = (model: string, input: unknown): void => {
    if (!input || typeof input !== 'object') return;
    if (Array.isArray(input)) {
      for (const item of input) transformData(model, item);
      return;
    }
    const data = input as Record<string, unknown>;
    const emailField = model === 'Customer' ? 'email' : model === 'Lead' ? 'contactEmail' : null;
    const tokenField = model === 'Customer' ? 'emailSearchTokens' : model === 'Lead' ? 'contactEmailSearchTokens' : null;
    if (emailField && tokenField && Object.hasOwn(data, emailField)) {
      const candidate = data[emailField];
      const plaintext = typeof candidate === 'object' && candidate !== null && 'set' in candidate
        ? (candidate as { set?: unknown }).set
        : candidate;
      data[tokenField] = typeof plaintext === 'string' && plaintext ? { set: searchTokens(plaintext) } : { set: [] };
      if (!('set' in (typeof candidate === 'object' && candidate !== null ? candidate : {}))) {
        data[tokenField] = typeof plaintext === 'string' && plaintext ? searchTokens(plaintext) : [];
      }
    }
    for (const field of encryptedFieldsByModel[model as keyof typeof encryptedFieldsByModel] ?? []) {
      const value = data[field];
      if (typeof value === 'object' && value !== null && 'set' in value) {
        const operation = value as { set?: unknown };
        operation.set = encryptValue(field, operation.set);
      } else {
        data[field] = encryptValue(field, value);
      }
    }
    for (const field of encryptedJsonFieldsByModel[model as keyof typeof encryptedJsonFieldsByModel] ?? []) {
      const value = data[field];
      if (!options.enabled || !options.cipher || value === undefined || value === null) continue;
      if (typeof value === 'string' && isEncryptedSecret(value)) {
        data[field] = options.cipher.rotate(value, `database-json-field:${field}`);
        continue;
      }
      data[field] = options.cipher.encrypt(JSON.stringify(value), `database-json-field:${field}`);
    }
  };

  const encryptMutation = (model: string | undefined, action: string, args: unknown): void => {
    if (!model || !args || typeof args !== 'object') return;
    const mutation = args as Record<string, unknown>;
    if (['create', 'createMany', 'update', 'updateMany'].includes(action)) transformData(model, mutation.data);
    if (action === 'upsert') {
      transformData(model, mutation.create);
      transformData(model, mutation.update);
    }
  };

  const decryptResult = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(decryptResult);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    const record = value as Record<string, unknown>;
    for (const [field, item] of Object.entries(record)) {
      if (internalFields.has(field)) {
        delete record[field];
      } else if (encryptedJsonFieldNames.has(field) && typeof item === 'string' && isEncryptedSecret(item) && options.cipher) {
        record[field] = JSON.parse(options.cipher.decrypt(item, `database-json-field:${field}`)) as unknown;
      } else if (encryptedFieldNames.has(field) && typeof item === 'string' && isEncryptedSecret(item) && options.cipher) {
        record[field] = options.cipher.decrypt(item, `database-field:${field}`);
      } else {
        record[field] = decryptResult(item);
      }
    }
    return record;
  };

  return { decryptResult, encryptMutation, searchTokens, searchTokenQuery };
}
