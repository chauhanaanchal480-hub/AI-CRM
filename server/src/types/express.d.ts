import type { AccessTokenPayload } from '../utils/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      requestId: string;
      rawBody?: Buffer;
      multipartBodyParsed?: boolean;
      apiClientId?: string;
      apiVersion?: string;
    }
  }
}

export {};
