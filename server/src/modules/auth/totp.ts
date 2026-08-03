import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;

export function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function counterBuffer(counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

export function totpCode(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 1000 / PERIOD_SECONDS);
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counterBuffer(counter)).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** DIGITS)).padStart(DIGITS, '0');
}

export function verifyTotp(secret: string, code: string, timestamp = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const supplied = Buffer.from(code);
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = Buffer.from(totpCode(secret, timestamp + offset * PERIOD_SECONDS * 1000));
    if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}

export function generateTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(20));
}

export function totpProvisioningUri(email: string, secret: string): string {
  const issuer = 'AI CRM';
  const label = `${issuer}:${email}`;
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${encodeURIComponent(label)}?${query}`;
}
