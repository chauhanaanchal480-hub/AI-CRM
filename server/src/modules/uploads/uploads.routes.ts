import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { logActivity } from '../../services/activity.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { uploadRateLimiter } from '../../middleware/rateLimit.js';
import { hmacMultipartRequestSigning } from '../../middleware/hmacRequestSigning.js';

const uploadDir = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    // Random name; keep only a sanitized extension from the original.
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  },
});

const MIME_EXTENSIONS: Record<string, ReadonlySet<string>> = {
  'image/png': new Set(['.png']),
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/gif': new Set(['.gif']),
  'image/webp': new Set(['.webp']),
  'application/pdf': new Set(['.pdf']),
  'text/plain': new Set(['.txt']),
  'text/csv': new Set(['.csv']),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': new Set(['.xlsx']),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': new Set(['.docx']),
};

// Extensions that must never land on disk regardless of claimed MIME type.
const BLOCKED_EXT = new Set([
  '.exe', '.dll', '.so', '.sh', '.bat', '.cmd', '.com', '.msi', '.scr',
  '.ps1', '.vbs', '.js', '.mjs', '.jar', '.php', '.py', '.rb', '.pl',
  '.cgi', '.htaccess', '.svg', '.html', '.htm',
]);

const KNOWN_EXTENSIONS = new Set([
  ...BLOCKED_EXT,
  ...Object.values(MIME_EXTENSIONS).flatMap((extensions) => [...extensions]),
]);

function sanitizeFilename(filename: string): string {
  const basename = path.basename(filename.replace(/\\/g, '/')).normalize('NFKC');
  const ext = path.extname(basename).toLowerCase();
  const stem = basename.slice(0, basename.length - ext.length)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|[. ]+$/g, '')
    .trim();
  const maxStemBytes = 255 - Buffer.byteLength(ext, 'utf8');
  let safeStem = '';
  for (const character of stem || 'upload') {
    if (Buffer.byteLength(safeStem + character, 'utf8') > maxStemBytes) break;
    safeStem += character;
  }
  return `${safeStem || 'upload'}${ext}`;
}

function hasDoubleExtension(filename: string): boolean {
  const parts = path.basename(filename.replace(/\\/g, '/')).toLowerCase().split('.');
  return parts.length > 2 && parts.slice(1, -1).some((part) => KNOWN_EXTENSIONS.has(`.${part}`));
}

function logBlockedUpload(req: Request, reason: string, file?: Pick<Express.Multer.File, 'originalname' | 'mimetype'>) {
  logger.warn(
    {
      event: 'security.upload_blocked',
      reason,
      userId: req.user?.sub,
      extension: file ? path.extname(file.originalname).toLowerCase() : undefined,
      claimedMimeType: file?.mimetype,
    },
    'Blocked file upload attempt',
  );
}

const resourceId = z.string().cuid('Invalid id');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

async function readZipEntryNames(filePath: string, size: number): Promise<Set<string> | null> {
  const tailSize = Math.min(size, 65_557);
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const tail = Buffer.alloc(tailSize);
    await fh.read(tail, 0, tailSize, size - tailSize);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (directorySize > size || directoryOffset + directorySize > size) return null;

    const directory = Buffer.alloc(directorySize);
    await fh.read(directory, 0, directorySize, directoryOffset);
    const names = new Set<string>();
    let offset = 0;
    while (offset < directory.length) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) return null;
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > directory.length) return null;
      names.add(directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/').toLowerCase());
      offset = end;
    }
    return names;
  } finally {
    await fh.close();
  }
}

async function isUtf8Text(filePath: string): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const value of fs.createReadStream(filePath)) {
      const chunk = value as Buffer;
      for (const byte of chunk) {
        if (byte === 0 || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)) return false;
      }
      decoder.decode(chunk, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

async function verifyMagicBytes(filePath: string, mimetype: string): Promise<boolean> {
  const stat = await fs.promises.stat(filePath);
  if (stat.size === 0) return false;
  const headSize = Math.min(stat.size, 16);
  const tailSize = Math.min(stat.size, 2048);
  const fh = await fs.promises.open(filePath, 'r');
  let head: Buffer;
  let tail: Buffer;
  try {
    head = Buffer.alloc(headSize);
    tail = Buffer.alloc(tailSize);
    await Promise.all([
      fh.read(head, 0, headSize, 0),
      fh.read(tail, 0, tailSize, stat.size - tailSize),
    ]);
  } finally {
    await fh.close();
  }

  if (mimetype === 'image/png') return head.subarray(0, 8).equals(PNG_SIGNATURE) && tail.subarray(-12).equals(PNG_END);
  if (mimetype === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff && tail.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 0;
  if (mimetype === 'image/gif') return /^(GIF87a|GIF89a)$/.test(head.subarray(0, 6).toString('ascii')) && tail[tail.length - 1] === 0x3b;
  if (mimetype === 'image/webp') {
    return head.subarray(0, 4).toString('ascii') === 'RIFF'
      && head.subarray(8, 12).toString('ascii') === 'WEBP'
      && head.readUInt32LE(4) + 8 === stat.size;
  }
  if (mimetype === 'application/pdf') {
    return head.subarray(0, 5).toString('ascii') === '%PDF-' && tail.includes(Buffer.from('%%EOF'));
  }
  if (mimetype === 'text/plain' || mimetype === 'text/csv') {
    const knownBinary = head.subarray(0, 2).toString('ascii') === 'MZ'
      || head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      || head.subarray(0, 4).toString('ascii').startsWith('PK\u0003\u0004')
      || head.subarray(0, 5).toString('ascii') === '%PDF-'
      || head.subarray(0, 8).equals(PNG_SIGNATURE);
    return !knownBinary && isUtf8Text(filePath);
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    if (head.length < 4 || head.readUInt32LE(0) !== 0x04034b50) return false;
    const names = await readZipEntryNames(filePath, stat.size);
    if (!names?.has('[content_types].xml')) return false;
    return mimetype.includes('spreadsheetml') ? names.has('xl/workbook.xml') : names.has('word/document.xml');
  }
  return false;
}

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const reject = (reason: string, message: string) => {
      logBlockedUpload(req, reason, file);
      return cb(new ApiError(400, message));
    };
    if (hasDoubleExtension(file.originalname)) return reject('double_extension', 'Double file extensions are not allowed');
    if (BLOCKED_EXT.has(ext)) return reject('blocked_extension', 'This file type is not allowed');
    if (Buffer.byteLength(file.originalname, 'utf8') > 255) return reject('filename_too_long', 'Filename is too long');
    const extensions = MIME_EXTENSIONS[file.mimetype];
    if (!extensions) return reject('unsupported_mime_type', 'Unsupported file type');
    if (!extensions.has(ext)) return reject('mime_extension_mismatch', 'File extension does not match its declared type');
    file.originalname = sanitizeFilename(file.originalname);
    return cb(null, true);
  },
});

function acceptSingleUpload(req: Request, res: Response, next: (error?: unknown) => void) {
  upload.single('file')(req, res, (error: unknown) => {
    if (!(error instanceof multer.MulterError)) return next(error);
    const isOversized = error.code === 'LIMIT_FILE_SIZE';
    logBlockedUpload(req, isOversized ? 'file_too_large' : error.code.toLowerCase(), req.file);
    return next(new ApiError(isOversized ? 413 : 400, isOversized ? 'File exceeds the maximum allowed size' : 'Invalid file upload'));
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
      logBlockedUpload(req, 'file_missing');
      throw ApiError.badRequest('No file provided (field name must be "file")');
    }
    let contentIsValid = false;
    try {
      contentIsValid = await verifyMagicBytes(req.file.path, req.file.mimetype);
    } catch {
      await fs.promises.unlink(req.file.path).catch(() => undefined);
      logBlockedUpload(req, 'content_verification_failed', req.file);
      throw ApiError.badRequest('Unable to verify file content');
    }
    if (!contentIsValid) {
      await fs.promises.unlink(req.file.path).catch(() => undefined);
      logBlockedUpload(req, 'content_type_mismatch', req.file);
      throw ApiError.badRequest('File content does not match its declared type');
    }
    const { customerId, dealId } = req.body as { customerId?: string; dealId?: string };
    if ((customerId && !resourceId.safeParse(customerId).success)
      || (dealId && !resourceId.safeParse(dealId).success)) {
      await fs.promises.unlink(req.file.path).catch(() => undefined);
      throw ApiError.badRequest('Invalid customerId or dealId');
    }
    // Validate target records exist before creating the attachment row.
    if (customerId && !(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) {
      await fs.promises.unlink(req.file.path).catch(() => undefined);
      throw ApiError.badRequest('Customer does not exist');
    }
    if (dealId && !(await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } }))) {
      await fs.promises.unlink(req.file.path).catch(() => undefined);
      throw ApiError.badRequest('Deal does not exist');
    }

    const attachment = await prisma.attachment.create({
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`,
        customerId: customerId || null,
        dealId: dealId || null,
        uploadedById: req.user!.sub,
      },
    });

    if (customerId) {
      await logActivity({ type: 'FILE', summary: `Uploaded "${req.file.originalname}"`, userId: req.user!.sub, customerId });
    }
    return sendSuccess(res, attachment, 201);
  }),
);

uploadsRouter.delete(
  '/:id',
  validate({ params: z.object({ id: resourceId }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!attachment) throw ApiError.notFound('Attachment not found');
    if (req.user!.role === 'EMPLOYEE' && attachment.uploadedById !== req.user!.sub) {
      throw ApiError.forbidden('You can only delete your own uploads');
    }
    // Remove the physical file (ignore if already gone). basename() guards
    // against any path separators sneaking into the stored filename.
    const filePath = path.join(uploadDir, path.basename(attachment.filename));
    fs.promises.unlink(filePath).catch(() => undefined);
    await prisma.attachment.delete({ where: { id: req.params.id } });
    return sendSuccess(res, { id: req.params.id });
  }),
);
