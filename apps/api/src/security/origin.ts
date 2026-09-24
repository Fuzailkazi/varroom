import type { NextFunction, Request, Response } from "express";
import type { Env } from "../env.ts";
import { sendError } from "../errors.ts";

// The websites allowed to send write requests with a fan's session cookie.
// Better Auth (auth.ts) and requireTrustedOrigin below both read this list,
// so they can never disagree. Today it is only the API's own origin:
// new URL("http://localhost:3001/anything").origin is "http://localhost:3001".
export function getTrustedOrigins(env: Env): string[] {
  const ourOrigin = new URL(env.BETTER_AUTH_URL).origin;
  return [ourOrigin];
}

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const METHODS_WITH_A_BODY = ["POST", "PUT", "PATCH"];

// CSRF protection for our own write routes (spec 0004, AC-3).
// A browser always sends an Origin header on a POST or DELETE, so a missing
// or unknown Origin means the request did not come from our site.
// It is mounted in app.ts before express.json(), so a bad origin is refused
// before we even read the body. GET requests pass straight through.
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

    // Our write routes only take JSON. req.is() also accepts
    // "application/json; charset=utf-8".
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
