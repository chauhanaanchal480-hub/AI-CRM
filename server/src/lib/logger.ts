import { pino } from 'pino';
import { isDev } from '../config/env.js';
import { maskSensitiveValue } from '../security/secrets.js';

const redact = {
  paths: [
    'password', 'currentPassword', 'newPassword', 'token', 'accessToken', 'refreshToken',
    'secret', 'cookieSecret', 'encryptionKey', 'encryptionKeys', 'databaseUrl', 'apiKey',
    '*.password', '*.currentPassword', '*.newPassword', '*.token', '*.accessToken', '*.refreshToken',
    '*.secret', '*.cookieSecret', '*.encryptionKey', '*.encryptionKeys', '*.databaseUrl', '*.apiKey',
    '*.*.password', '*.*.currentPassword', '*.*.newPassword', '*.*.token', '*.*.accessToken', '*.*.refreshToken',
    '*.*.secret', '*.*.cookieSecret', '*.*.encryptionKey', '*.*.encryptionKeys', '*.*.databaseUrl', '*.*.apiKey',
    'authorization', 'Authorization', 'cookie', 'setCookie',
    '*.authorization', '*.Authorization', '*.cookie', '*.setCookie',
    'req.headers.authorization', 'req.headers.cookie',
    'err.config.headers.authorization', 'err.config.headers.Authorization',
  ],
  censor: '[REDACTED]',
};

export const logger = pino(
  isDev
    ? {
        level: 'debug',
        redact,
        hooks: {
          logMethod(args, method) {
            return method.apply(this, args.map((arg) => maskSensitiveValue(arg)) as Parameters<typeof method>);
          },
        },
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {
        level: 'info',
        redact,
        hooks: {
          logMethod(args, method) {
            return method.apply(this, args.map((arg) => maskSensitiveValue(arg)) as Parameters<typeof method>);
          },
        },
      },
);
