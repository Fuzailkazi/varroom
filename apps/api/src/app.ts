import express from "express";
import type { NextFunction, Request, Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { checkDatabase, getUserProfile } from "@varroom/db";
import { HealthResponse, MeResponse } from "@varroom/shared";
import { createAuth } from "./auth/auth.ts";
import { createSendEmail } from "./auth/email.ts";
import { requireSession, requireVerified } from "./auth/guards.ts";
import { createCommentsRouter, createDebateCommentsRouter } from "./comments/routes.ts";
import { createDebatesRouter, listTagsHandler } from "./debates/routes.ts";
import type { Env } from "./env.ts";
import { errorHandler, sendError } from "./errors.ts";
import { getTrustedOrigins, requireTrustedOrigin } from "./security/origin.ts";

// Builds the Express app without starting it, so tests can run it on a
// random port. server.ts is the only file that calls listen().
export function createApp(env: Env) {
  const app = express();

  // In production Railway's proxy sits in front of us. This tells Express
  // to trust one proxy, so req.ip is the fan's IP and not the proxy's.
  app.set("trust proxy", 1);

  // Sign in. Better Auth reads the request body itself, so this line
  // MUST come before express.json() below, or the body is already used up.
  const sendEmail = createSendEmail(env);
  const auth = createAuth(env, sendEmail);
  app.locals.auth = auth; // the guards read it from here
  // better auth reads x-forwarded-for as is, so a client could spoof it and dodge the
  // rate limit. replace it with express's req.ip, which honours trust proxy above
  app.use("/api/auth", useTrustedIp);
  app.all("/api/auth/*splat", toNodeHandler(auth));

  // csrf + content type guard for our write routes. before express.json() so bad requests never get parsed
  app.use("/api", requireTrustedOrigin(getTrustedOrigins(env)));

  // From here on, JSON request bodies are parsed into req.body.
  app.use(express.json());

  app.get("/api/health", healthHandler);
  app.get("/api/me", requireSession, meHandler);

  // debates + tags
  app.use("/api/debates/:id/comments", createDebateCommentsRouter());
  app.use("/api/debates", createDebatesRouter());
  app.use("/api/comments", createCommentsRouter());
  app.get("/api/tags", listTagsHandler);

  // A stand in for the real write routes (posting, voting) until
  // they exist. Only added while running tests.
  if (env.NODE_ENV === "test") {
    app.post("/api/_test/verified-ping", requireVerified, (_req, res) => {
      res.json({ ok: true });
    });
  }

  // Any other /api route does not exist.
  app.use("/api", (_req, res) => {
    sendError(res, 404, "NOT_FOUND", "No such route.");
  });

  // Must be last: turns thrown errors into our error shape.
  app.use(errorHandler);

  return app;
}

// overwrites the ip headers with the one address express trusts (req.ip)
function useTrustedIp(req: Request, _res: Response, next: NextFunction) {
  req.headers["x-forwarded-for"] = req.ip;
  delete req.headers["x-real-ip"];
  next();
}

// GET /api/health: is the API up, and can it reach the database?
async function healthHandler(_req: Request, res: Response) {
  const database = await checkDatabase();
  const body = HealthResponse.parse({
    status: database === "up" ? "ok" : "degraded",
    database: database,
    time: new Date().toISOString(),
  });
  res.status(database === "up" ? 200 : 503).json(body);
}

// GET /api/me: the signed in fan's own profile.
// requireSession runs first, so req.signedIn is always set here.
async function meHandler(req: Request, res: Response) {
  const userId = req.signedIn!.user.id;
  const profile = await getUserProfile(userId);

  // The user was deleted a moment ago, in another request.
  if (!profile) {
    sendError(res, 401, "UNAUTHENTICATED", "Sign in first.");
    return;
  }

  // Every account made through sign up has a username (it is required).
  const username = profile.username ?? "";
  const displayUsername = profile.displayUsername ?? username;

  const body = MeResponse.parse({
    id: profile.id,
    username: username,
    displayUsername: displayUsername,
    displayName: profile.name,
    email: profile.email,
    emailVerified: profile.emailVerified,
    role: profile.role,
    badge: profile.badge,
    tacticalIqScore: profile.tacticalIqScore,
    joinedAt: profile.createdAt.toISOString(),
  });
  res.json(body);
}
