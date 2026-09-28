import { rateLimit } from "express-rate-limit";
import type { Request, Response } from "express";
import { sendError } from "../errors.ts";

// per ip rate limits for the public review reads, so a script can't hammer them.
// the counts live in this process's memory, so they start over on every restart

// how many requests one ip may make per minute
export type RateLimits = {
  reviewReadsPerMinute: number; // GET /api/reviews/:id and /api/reviews/availability, one shared counter
  reviewStreamsPerMinute: number; // GET /api/reviews/:id/events, counted per stream opened
};

export const DEFAULT_RATE_LIMITS: RateLimits = {
  reviewReadsPerMinute: 60,
  reviewStreamsPerMinute: 20,
};

const ONE_MINUTE_MS = 60 * 1000;

// what an ip gets once it's over the limit. the limiter has already set Retry-After
function sendRateLimited(_req: Request, res: Response) {
  sendError(res, 429, "RATE_LIMITED", "Too many requests. Wait a moment and try again.");
}

// a middleware that lets each ip (req.ip, which honours trust proxy) make `limit`
// requests a minute. put it before the handler, so a blocked request never reaches the db
export function createPerMinuteLimiter(limit: number) {
  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: limit,
    // the standard RateLimit headers, not the old X-RateLimit-* ones
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // count every ip address on its own. by default the library puts all ipv6
    // addresses of one /56 network in a single counter, so neighbours would block each other
    ipv6Subnet: false,
    handler: sendRateLimited,
  });
}
