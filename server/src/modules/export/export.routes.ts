import fs from 'node:fs';
import { finished } from 'node:stream/promises';
import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { exportRateLimiter } from '../../middleware/rateLimit.js';
import {
  prepareExport,
  resolvePreparedExport,
  type ExportEntity,
  type ExportFormat,
} from './export.service.js';

const params = z.object({ entity: z.enum(['customers', 'leads', 'deals']) });

async function sendExport(req: Request, res: Response, format: ExportFormat) {
  const entity = req.params.entity as ExportEntity;
  const prepared = await prepareExport({ entity, format, role: req.user!.role, userId: req.user!.sub });
  const file = resolvePreparedExport(prepared.filename);
  const extension = format === 'excel' ? 'xlsx' : 'pdf';
  res.setHeader('Content-Type', format === 'excel'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${entity}-${Date.now()}.${extension}"`);
  res.setHeader('Content-Length', prepared.size);
  const source = fs.createReadStream(file);
  res.once('close', () => source.destroy());
  try {
    source.pipe(res);
    await finished(source);
  } finally {
    await fs.promises.rm(file, { force: true }).catch(() => undefined);
  }
}

export const exportRouter = Router();
exportRouter.use(authenticate, exportRateLimiter);

exportRouter.get('/:entity/excel', validate({ params }), asyncHandler((req, res) => sendExport(req, res, 'excel')));
exportRouter.get('/:entity/pdf', validate({ params }), asyncHandler((req, res) => sendExport(req, res, 'pdf')));
exportRouter.use((req, _res, next) => next(ApiError.notFound(`Unknown export route ${req.path}`)));
