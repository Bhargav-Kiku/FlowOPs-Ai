import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route handler so that any thrown error is automatically
 * forwarded to Express's global error handler via next(err).
 *
 * Express 4 does NOT catch async errors automatically — this wrapper is required.
 */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
