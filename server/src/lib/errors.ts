import type { Request, Response, NextFunction } from 'express';

/** Typed API error. Throw from route handlers; errorHandler converts to JSON. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new ApiError(400, code, msg);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, 'unauthorized', msg);
export const forbidden = (msg: string, code = 'forbidden') => new ApiError(403, code, msg);
export const notFound = (msg = 'Not found') => new ApiError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new ApiError(409, code, msg);

/** §3 license-gate refusals get a distinct code so clients (and tests) can assert on them. */
export const licenseForbidden = (msg: string) => new ApiError(403, 'license_forbidden', msg);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
}

/** Wrap async route handlers so thrown errors reach errorHandler. */
export function wrap(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
