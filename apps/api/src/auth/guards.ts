import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { sendError } from "../errors.ts";
import type { Auth } from "./auth.ts";

// Guards are Express middleware that run before a route. They either
// let the request through (by calling next()) or answer with an error.
// Reading never needs a guard. Every write route (post, vote, comment)
// uses requireVerified, like this:
//
//   app.post("/api/debates", requireVerified, createDebateHandler);
//
// See spec 0003.

// What Better Auth gives back for a signed in fan: { user, session }.
export type SignedIn = Auth["$Infer"]["Session"];

// This teaches TypeScript about two things we add to Express objects:
//   app.locals.auth  the Better Auth object (set once in createApp)
//   req.signedIn     the signed in fan (set by the guards below)
declare global {
  namespace Express {
    interface Locals {
      auth: Auth;
    }
    interface Request {
      signedIn?: SignedIn;
    }
  }
}

// Asks Better Auth who owns the session cookie on this request.
// Returns null if there is no cookie, or the session expired or was revoked.
async function getSignedIn(req: Request): Promise<SignedIn | null> {
  // Already looked up earlier in this same request.
  if (req.signedIn) {
    return req.signedIn;
  }

  const auth = req.app.locals.auth;
  const headers = fromNodeHeaders(req.headers);
  const session = await auth.api.getSession({ headers: headers });

  if (session) {
    req.signedIn = session;
  }
  return session;
}

// Lets the request through only if the fan is signed in.
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const signedIn = await getSignedIn(req);
  if (!signedIn) {
    sendError(res, 401, "UNAUTHENTICATED", "Sign in first.");
    return;
  }
  next();
}

// AC-4: signed in AND the email is confirmed.
export async function requireVerified(req: Request, res: Response, next: NextFunction) {
  const signedIn = await getSignedIn(req);
  if (!signedIn) {
    sendError(res, 401, "UNAUTHENTICATED", "Sign in first.");
    return;
  }
  if (!signedIn.user.emailVerified) {
    sendError(res, 403, "EMAIL_NOT_VERIFIED", "Confirm your email first. Check your inbox for the link.");
    return;
  }
  next();
}

// Signed in AND has the given role. Used later by moderation (feature 15):
//   app.delete("/api/admin/debates/:id", requireRole("ADMIN"), handler);
export function requireRole(role: "USER" | "ADMIN") {
  return async function checkRole(req: Request, res: Response, next: NextFunction) {
    const signedIn = await getSignedIn(req);
    if (!signedIn) {
      sendError(res, 401, "UNAUTHENTICATED", "Sign in first.");
      return;
    }
    if (signedIn.user.role !== role) {
      sendError(res, 403, "FORBIDDEN", "You don't have access to this.");
      return;
    }
    next();
  };
}
