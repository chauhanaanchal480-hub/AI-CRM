import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { env, isProd } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/apiResponse.js';
import { logger } from './lib/logger.js';

const SQLI_SIGNATURES = [
  { name: 'boolean_tautology', pattern: /['"]\s*or\s+1\s*=\s*1/i },
  { name: 'union_select', pattern: /\bunion\s+select\b/i },
  { name: 'drop_table', pattern: /\bdrop\s+table\b/i },
  { name: 'information_schema', pattern: /\binformation_schema\b/i },
  { name: 'sleep_function', pattern: /\bsleep\s*\(/i },
  { name: 'benchmark_function', pattern: /\bbenchmark\s*\(/i },
  { name: 'sql_comment', pattern: /--|\/\*/ },
] as const;

function findSqliSignatures(value: unknown) {
  let input: string;
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof serialized !== 'string') return [];
    input = serialized;
  } catch {
    return [];
  }
  return SQLI_SIGNATURES.filter(({ pattern }) => pattern.test(input)).map(({ name }) => name);
}

const corsOrigins = new Set(
  env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

if (corsOrigins.has('*')) {
  throw new Error('CORS_ORIGIN cannot contain "*" when credentialed requests are enabled');
}

morgan.token('safe-url', (req) => req.url?.split('?', 1)[0] ?? '-');

export function createApp() {
  const app = express();

  // Behind a reverse proxy in production, trust the first hop so req.ip and
  // rate limiting see the real client address.
  if (isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          childSrc: ["'none'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          formAction: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          manifestSrc: ["'self'"],
          mediaSrc: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'"],
          styleSrcAttr: ["'none'"],
          workerSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), web-share=(), xr-spatial-tracking=()',
    );
    next();
  });
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || corsOrigins.has(origin.replace(/\/$/, ''))) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
      optionsSuccessStatus: 204,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 100 }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    const matches = [
      { location: 'path', signatures: findSqliSignatures(req.path) },
      { location: 'query', signatures: findSqliSignatures(req.query) },
      { location: 'body', signatures: findSqliSignatures(req.body) },
    ].filter(({ signatures }) => signatures.length > 0);

    if (matches.length > 0) {
      logger.warn(
        {
          event: 'security.sql_injection_detected',
          method: req.method,
          locations: matches.map(({ location }) => location),
          signatures: [...new Set(matches.flatMap(({ signatures }) => signatures))],
        },
        'Potential SQL injection payload detected',
      );
    }
    next();
  });
  app.use(
    morgan(
      ':remote-addr - [:date[iso]] ":method :safe-url HTTP/:http-version" :status :res[content-length] :response-time ms',
    ),
  );

  // Serve uploaded files statically — never execute or let the browser sniff.
  app.use(
    '/uploads',
    express.static(path.resolve(env.UPLOAD_DIR), {
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    }),
  );

  // Global rate limiter (production only — e2e suites exceed it and get 429s)
  if (isProd) {
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 1000,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );
  }

  app.get('/health', (_req, res) => sendSuccess(res, { status: 'ok', uptime: process.uptime() }));

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
