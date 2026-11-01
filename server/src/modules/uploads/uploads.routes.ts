import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { env } from '../../config/env.js';
import { uploadRateLimiter } from '../../middleware/rateLimit.js';
import { hmacMultipartRequestSigning } from '../../middleware/hmacRequestSigning.js';
import { uploadsService, uploadStorage } from './uploads.service.js';

const resourceId = z.string().cuid('Invalid id');
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    try {
      uploadsService.validateDeclaration(req.user?.sub, file);
      callback(null, true);
    } catch (error) {
      callback(error as Error);
    }
  },
});

function acceptSingleUpload(req: Request, res: Response, next: (error?: unknown) => void) {
  upload.single('file')(req, res, (error: unknown) => {
    if (!(error instanceof multer.MulterError)) return next(error);
    const isOversized = error.code === 'LIMIT_FILE_SIZE';
    uploadsService.logBlocked(
      req.user?.sub,
      isOversized ? 'file_too_large' : error.code.toLowerCase(),
      req.file,
    );
    return next(new ApiError(
      isOversized ? 413 : 400,
      isOversized ? 'File exceeds the maximum allowed size' : 'Invalid file upload',
    ));
  });
}

export const uploadsRouter = Router();
uploadsRouter.use(authenticate);

uploadsRouter.post(
  '/',
  uploadRateLimiter,
  acceptSingleUpload,
  hmacMultipartRequestSigning,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      uploadsService.logBlocked(req.user?.sub, 'file_missing');
      throw ApiError.badRequest('No file provided (field name must be "file")');
    }
    const refs = req.body as { customerId?: string; dealId?: string };
    if ((refs.customerId && !resourceId.safeParse(refs.customerId).success)
      || (refs.dealId && !resourceId.safeParse(refs.dealId).success)) {
      await uploadsService.discard(req.file.path);
      throw ApiError.badRequest('Invalid customerId or dealId');
    }
    return sendSuccess(
      res,
      await uploadsService.create(
        { id: req.user!.sub, role: req.user!.role },
        req.file,
        refs,
      ),
      201,
    );
  }),
);

uploadsRouter.delete(
  '/:id',
  validate({ params: z.object({ id: resourceId }) }),
  asyncHandler(async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await uploadsService.remove({ id: req.user!.sub, role: req.user!.role }, req.params.id),
    )),
);
