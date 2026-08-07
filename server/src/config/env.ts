import dotenv from 'dotenv';
import { EnvironmentValidationError, parseEnvironment } from './environment.js';

dotenv.config();

let parsed: ReturnType<typeof parseEnvironment>;
try {
  parsed = parseEnvironment(process.env);
} catch (error) {
  const message = error instanceof EnvironmentValidationError
    ? error.message
    : 'Invalid environment configuration';
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
}

export const env = parsed;
export const secretCipher = parsed.secretCipher;
export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

// Keep decrypted credentials in the validated config object, not in the
// process-wide environment where diagnostics and child processes can expose them.
for (const name of [
  'DATABASE_URL', 'DATABASE_URL_ENCRYPTED', 'RETENTION_DATABASE_URL', 'REDIS_URL', 'REDIS_URL_ENCRYPTED', 'ENCRYPTION_KEYS', 'ENCRYPTION_CURRENT_KEY_ID', 'FIELD_SEARCH_KEY',
  'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_ENCRYPTED',
  'OPENAI_API_KEY', 'OPENAI_API_KEY_ENCRYPTED',
  'GEMINI_API_KEY', 'GEMINI_API_KEY_ENCRYPTED',
]) {
  delete process.env[name];
}
