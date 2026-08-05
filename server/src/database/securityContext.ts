import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface DatabaseSecurityContext {
  actorId?: string;
  requestId: string;
  /** Reserved for trusted maintenance jobs that must process retained rows. */
  allowDeleted?: boolean;
}

const storage = new AsyncLocalStorage<DatabaseSecurityContext>();

export function databaseSecurityContext(req: Request, _res: Response, next: NextFunction) {
  runWithDatabaseSecurityContext({ requestId: req.requestId }, next);
}

export function runWithDatabaseSecurityContext<T>(context: DatabaseSecurityContext, operation: () => T): T {
  return storage.run(context, operation);
}

export function setDatabaseActor(actorId: string) {
  const context = storage.getStore();
  if (context) context.actorId = actorId;
}

export function getDatabaseSecurityContext(): Readonly<DatabaseSecurityContext> | undefined {
  return storage.getStore();
}
