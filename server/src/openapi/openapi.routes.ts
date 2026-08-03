import { Router } from 'express';
import { apiSecurityConfig } from '../config/apiSecurity.js';
import { openApiDocument } from './document.js';
import { ApiError } from '../utils/ApiError.js';

export const openApiRouter = Router();

openApiRouter.use((_req, res, next) => {
  if (!apiSecurityConfig.docsEnabled) return next(ApiError.notFound('API documentation is disabled'));
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return next();
});

openApiRouter.get(['/openapi.json', '/docs'], (_req, res) => res.json(openApiDocument));
