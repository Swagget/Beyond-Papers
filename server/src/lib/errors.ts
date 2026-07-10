import type { Request, Response, NextFunction } from 'express';

/** Typed API error (spec §14). Throw from route handlers; errorHandler converts to JSON. */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const validationError = (msg: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg: string) => new AppError(403, 'FORBIDDEN', msg);
/** §3 license-gate refusals get a distinct code so clients (and tests) can assert on them. */
export const licenseGate = (msg: string, status: 403 | 422 = 403) => new AppError(status, 'LICENSE_GATE', msg);
export const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
export const invalidTransition = (msg: string) => new AppError(422, 'INVALID_TRANSITION', msg);
export const upstreamError = (msg: string) => new AppError(502, 'UPSTREAM_ERROR', msg);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}

/** Wrap async route handlers so rejected promises reach errorHandler (Express 4). */
export function wrapAsync(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
