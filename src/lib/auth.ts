import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { logger } from "./logger";

/**
 * Express middleware that validates the x-flowops-api-key header against
 * the FLOWOPS_API_KEY environment variable using a constant-time comparison
 * to prevent timing attacks.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers["x-flowops-api-key"];
  const expectedKey = process.env.FLOWOPS_API_KEY;

  if (!expectedKey) {
    logger.error("FLOWOPS_API_KEY environment variable is not set — blocking all requests");
    res.status(503).json({ error: "service_misconfigured", detail: "API key not configured on server" });
    return;
  }

  if (!apiKey || typeof apiKey !== "string") {
    logger.warn({ ip: req.ip, path: req.path }, "Request missing x-flowops-api-key header");
    res.status(401).json({ error: "unauthorized", detail: "Missing x-flowops-api-key header" });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    const provided = Buffer.from(apiKey.padEnd(expectedKey.length, "\0"));
    const expected = Buffer.from(expectedKey.padEnd(apiKey.length, "\0"));
    const normalizedProvided = Buffer.from(apiKey.padEnd(Math.max(apiKey.length, expectedKey.length), "\0"));
    const normalizedExpected = Buffer.from(expectedKey.padEnd(Math.max(apiKey.length, expectedKey.length), "\0"));

    const isValid = timingSafeEqual(normalizedProvided, normalizedExpected) && provided.length === expected.length;

    if (!isValid) {
      logger.warn({ ip: req.ip, path: req.path }, "Invalid x-flowops-api-key");
      res.status(401).json({ error: "unauthorized", detail: "Invalid API key" });
      return;
    }
  } catch {
    logger.warn({ ip: req.ip, path: req.path }, "API key comparison error");
    res.status(401).json({ error: "unauthorized", detail: "Invalid API key" });
    return;
  }

  next();
}
