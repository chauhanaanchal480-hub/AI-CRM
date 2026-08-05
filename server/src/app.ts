import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { env, isProd } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/apiResponse.js';
import { logger } from './lib/logger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { auditTrailMiddleware } from './middleware/auditTrail.js';
import {
  globalApiRateLimiter,
  perIpRateLimiter,
  perUserRateLimiter,
} from './middleware/rateLimit.js';
import { createOriginValidation, normalizeOrigin } from './middleware/originValidation.js';
import {
  canonicalApiVersion,
  legacyApiVersion,
  rejectUnsupportedApiVersion,
  secureApiResponse,
} from './middleware/apiBoundary.js';
import { hmacRequestSigning } from './middleware/hmacRequestSigning.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { apiAbuseDetection } from './middleware/apiAbuseDetection.js';
import { openApiRouter } from './openapi/openapi.routes.js';
import { databaseSecurityContext } from './database/securityContext.js';

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
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin)),
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
  app.use(requestIdMiddleware);
  app.use(databaseSecurityContext);

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
      xContentTypeOptions: true,
      xFrameOptions: { action: 'deny' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), web-share=(), xr-spatial-tracking=()',
    );
    next();
  });
  app.use(createOriginValidation(corsOrigins));
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || corsOrigins.has(normalizeOrigin(origin) ?? '')) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Request-Id',
        'X-API-Key-Id',
        'X-API-Timestamp',
        'X-API-Nonce',
        'X-API-Signature',
      ],
      exposedHeaders: [
        'X-Request-Id',
        'X-API-Version',
        'X-Signature-Verified',
        'Idempotency-Key',
        'Idempotency-Replayed',
        'Deprecation',
        'Sunset',
        'Link',
      ],
      maxAge: 600,
      optionsSuccessStatus: 204,
    }),
  );
  app.use(express.json({
    limit: '2mb',
    verify: (req, _res, buffer) => { (req as express.Request).rawBody = Buffer.from(buffer); },
  }));
  app.use(express.urlencoded({
    extended: true,
    limit: '1mb',
    parameterLimit: 100,
    verify: (req, _res, buffer) => { (req as express.Request).rawBody = Buffer.from(buffer); },
  }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(auditTrailMiddleware);
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

  app.get('/health', (_req, res) => sendSuccess(res, { status: 'ok', uptime: process.uptime() }));

  const enterpriseApiSecurity = [
    secureApiResponse,
    hmacRequestSigning,
    globalApiRateLimiter,
    perIpRateLimiter,
    perUserRateLimiter,
    apiAbuseDetection,
    idempotencyMiddleware,
    openApiRouter,
  ];

  app.use('/api/v1', canonicalApiVersion, ...enterpriseApiSecurity, apiRouter, notFoundHandler);
  app.use('/api', rejectUnsupportedApiVersion, legacyApiVersion, ...enterpriseApiSecurity, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
