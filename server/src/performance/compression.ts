import { constants, createBrotliCompress, createGzip, type BrotliCompress, type Gzip } from 'node:zlib';
import type { RequestHandler, Response } from 'express';
import { env } from '../config/env.js';

type CompressionStream = BrotliCompress | Gzip;

export function negotiateEncoding(header: string | undefined): 'br' | 'gzip' | null {
  if (!header) return null;
  const qualities = new Map<string, number>();
  for (const entry of header.toLowerCase().split(',')) {
    const [name, ...parameters] = entry.trim().split(';');
    const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
    const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
    qualities.set(name, Number.isFinite(quality) ? quality : 0);
  }
  const wildcard = qualities.get('*') ?? 0;
  const brotli = qualities.get('br') ?? wildcard;
  const gzip = qualities.get('gzip') ?? wildcard;
  if (brotli <= 0 && gzip <= 0) return null;
  return brotli >= gzip ? 'br' : 'gzip';
}

function isCompressible(contentType: string) {
  return /^(?:text\/|application\/(?:json|javascript|xml|graphql|problem\+json)|image\/svg\+xml|font\/)/i.test(contentType);
}

function appendVary(res: Response, value: string) {
  const current = res.getHeader('Vary');
  const values = new Set(String(current ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  values.add(value);
  res.setHeader('Vary', [...values].join(', '));
}

/** Streaming Brotli compression with gzip fallback for API and static text. */
export function responseCompression(): RequestHandler {
  return (req, res, next) => {
    const encoding = negotiateEncoding(req.headers['accept-encoding']);
    if (!encoding || req.method === 'HEAD') return next();

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const originalWriteHead = res.writeHead.bind(res);
    let stream: CompressionStream | null = null;
    let configured = false;
    let ended = false;

    const configure = () => {
      if (configured) return;
      configured = true;
      const contentType = String(res.getHeader('Content-Type') ?? '');
      const contentLength = Number(res.getHeader('Content-Length') ?? Number.NaN);
      const cacheControl = String(res.getHeader('Cache-Control') ?? '');
      const existingEncoding = String(res.getHeader('Content-Encoding') ?? 'identity');
      const bodyAllowed = res.statusCode !== 204 && res.statusCode !== 304 && res.statusCode >= 200;
      if (!bodyAllowed
        || existingEncoding !== 'identity'
        || !isCompressible(contentType)
        || /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(cacheControl)
        || (Number.isFinite(contentLength) && contentLength < env.RESPONSE_COMPRESSION_THRESHOLD_BYTES)) return;

      stream = encoding === 'br'
        ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
        : createGzip({ level: 6 });
      appendVary(res, 'Accept-Encoding');
      res.setHeader('Content-Encoding', encoding);
      res.removeHeader('Content-Length');
      stream.on('data', (chunk: Buffer) => {
        if (!originalWrite(chunk)) stream?.pause();
      });
      stream.on('end', () => originalEnd());
      stream.on('error', () => res.destroy());
      res.on('drain', () => stream?.resume());
    };

    res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
      configure();
      return originalWriteHead(...args);
    }) as Response['writeHead'];

    res.write = ((chunk: unknown, chunkEncoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
      if (ended) return false;
      if (!res.headersSent) res.writeHead(res.statusCode);
      if (!stream) return originalWrite(chunk as never, chunkEncoding as never, callback as never);
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), chunkEncoding);
      return stream.write(buffer, callback);
    }) as Response['write'];

    res.end = ((chunk?: unknown, chunkEncoding?: BufferEncoding, callback?: () => void) => {
      if (ended) return res;
      if (!res.headersSent) {
        if (chunk !== undefined && !res.getHeader('Content-Length')) {
          const length = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), chunkEncoding);
          res.setHeader('Content-Length', length);
        }
        res.writeHead(res.statusCode);
      }
      if (!stream) return originalEnd(chunk as never, chunkEncoding as never, callback as never);
      ended = true;
      if (callback) stream.once('end', callback);
      const buffer = chunk === undefined
        ? undefined
        : Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), chunkEncoding);
      stream.end(buffer);
      return res;
    }) as Response['end'];

    (res as Response & { flush?: () => void }).flush = () => stream?.flush();
    return next();
  };
}
