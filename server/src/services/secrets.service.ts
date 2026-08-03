import { secretCipher } from '../config/env.js';
import { isEncryptedSecret } from '../security/secrets.js';

function configuredCipher() {
  if (!secretCipher) throw new Error('Secret encryption is not configured');
  return secretCipher;
}

/** Encrypt every newly stored secret with the active AES-256-GCM key. */
export function encryptStoredSecret(value: string, context: string): string {
  return configuredCipher().encrypt(value, context);
}

/** Plaintext fallback permits existing records to be read during migration. */
export function decryptStoredSecret(value: string, context: string): string {
  return isEncryptedSecret(value) ? configuredCipher().decrypt(value, context) : value;
}

/** Re-encrypt legacy plaintext or an old-key envelope with the active key. */
export function rotateStoredSecret(value: string, context: string): string {
  if (!isEncryptedSecret(value)) return configuredCipher().encrypt(value, context);
  return configuredCipher().rotate(value, context);
}
