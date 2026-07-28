import { pino } from 'pino';
import { isDev } from '../config/env.js';

const redact = {
  paths: [
    'password', 'currentPassword', 'newPassword', 'token', 'accessToken', 'refreshToken',
    '*.password', '*.currentPassword', '*.newPassword', '*.token', '*.accessToken', '*.refreshToken',
    '*.*.password', '*.*.currentPassword', '*.*.newPassword', '*.*.token', '*.*.accessToken', '*.*.refreshToken',
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
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : { level: 'info', redact },
);
