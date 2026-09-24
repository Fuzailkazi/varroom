import type { NextFunction, Request, Response } from "express";
import type { Env } from "../env.ts";
import { sendError } from "../errors.ts";

// origins allowed to make write requests with a session cookie.
// shared by better auth and requireTrustedOrigin so they never disagree
export function getTrustedOrigins(env: Env): string[] {
  const ourOrigin = new URL(env.BETTER_AUTH_URL).origin;
  return [ourOrigin];
}

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const METHODS_WITH_A_BODY = ["POST", "PUT", "PATCH"];

// csrf guard for our write routes. browsers always send Origin on POST/DELETE,
// so missing/unknown origin = not from our site. mounted before express.json()
// so bad requests get rejected before we parse the body. GETs pass through
export function requireTrustedOrigin(trustedOrigins: string[]) {
  return function checkOrigin(req: Request, res: Response, next: NextFunction) {
    if (!WRITE_METHODS.includes(req.method)) {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (!origin || !trustedOrigins.includes(origin)) {
      sendError(res, 403, "BAD_ORIGIN", "This request did not come from VAR Room.");
      return;
    }

    // write routes only take json. req.is handles the charset suffix too
    if (METHODS_WITH_A_BODY.includes(req.method)) {
      const isJson = req.is("application/json");
      if (!isJson) {
        sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Send the body as JSON (Content-Type: application/json).");
        return;
      }
    }

    next();
  };
}
