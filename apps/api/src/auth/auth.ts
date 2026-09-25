import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import { prisma } from "@varroom/db/client";
import type { Env } from "../env.ts";
import { getTrustedOrigins } from "../security/origin.ts";
import type { SendEmail } from "./email.ts";

// Better Auth does the hard parts of sign in for us: sign up, sign in,
// sessions, email confirmation, password reset and account deletion
// Its routes live under /api/auth/*.

const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

// username rules

const RESERVED_USERNAMES = ["admin", "var", "varroom", "deleted", "moderator", "support", "api", "system"];

// Only letters, numbers and underscores. The length (3 to 20) is
// checked by the username plugin itself, see createAuth below.
const USERNAME_CHARACTERS = /^[A-Za-z0-9_]+$/;

export function isAllowedUsername(name: string): boolean {
  if (!USERNAME_CHARACTERS.test(name)) {
    return false;
  }
  if (RESERVED_USERNAMES.includes(name.toLowerCase())) {
    return false;
  }
  return true;
}

// display name rule: 1 to 50 characters, spaces trimmed

function cleanDisplayName(name: unknown): string {
  let trimmed = "";
  if (typeof name === "string") {
    trimmed = name.trim();
  }

  if (trimmed.length < 1 || trimmed.length > 50) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_DISPLAY_NAME",
      message: "Display name must be 1 to 50 characters.",
    });
  }
  return trimmed;
}

// extra checks that run BEFORE Better Auth handles a request.
// throwing an APIError stops the request and sends that error back.

function checkSignUp(body: Record<string, unknown>) {
  if (typeof body.username !== "string") {
    throw new APIError("BAD_REQUEST", { code: "USERNAME_REQUIRED", message: "Pick a username." });
  }

  body.name = cleanDisplayName(body.name);

  // The name we show is always the username as the fan typed it.
  // Without this, someone could sign up as "jude" but display as "admin".
  delete body.displayUsername;
}

function checkUpdateUser(body: Record<string, unknown>) {
  // A username can never be changed.
  if ("username" in body || "displayUsername" in body) {
    throw new APIError("BAD_REQUEST", { code: "USERNAME_IS_IMMUTABLE", message: "Usernames can't be changed." });
  }

  if ("name" in body) {
    body.name = cleanDisplayName(body.name);
  }
}

function checkDeleteUser(body: Record<string, unknown>) {
  // Better Auth would allow deleting without a password if you
  // signed in recently. We always want the password.
  if (!body.password) {
    throw new APIError("BAD_REQUEST", {
      code: "PASSWORD_REQUIRED",
      message: "Enter your password to delete your account.",
    });
  }
}

const runExtraChecks = createAuthMiddleware(async (ctx) => {
  const body = ctx.body ?? {};

  if (ctx.path === "/sign-up/email") {
    checkSignUp(body);
  }
  if (ctx.path === "/update-user") {
    checkUpdateUser(body);
  }
  if (ctx.path === "/delete-user") {
    checkDeleteUser(body);
  }
});

// the Better Auth setup

export function createAuth(env: Env, sendEmail: SendEmail) {
  // At most 10 requests per minute from one IP address.
  const tenPerMinute = { window: 60, max: 10 };

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    // Only requests from our own site may use a session cookie (CSRF protection).
    trustedOrigins: getTrustedOrigins(env),
    database: prismaAdapter(prisma, { provider: "postgresql" }),

    // Hide Better Auth's warnings during tests, they are expected there.
    logger: { level: env.NODE_ENV === "test" ? "error" : "warn" },

    emailAndPassword: {
      enabled: true,
      autoSignIn: true, // Signing up also signs you in
      requireEmailVerification: false, // Unconfirmed fans can still sign in and read
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true, // A reset signs out every device

      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your VAR Room password",
          text: `Reset your password: ${url}`,
          url: url,
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true, // Send the confirmation link right away

      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your VAR Room email",
          text: `Confirm your email: ${url}`,
          url: url,
        });
      },
    },

    user: {
      // Our own extra columns on the users table.
      // input: false means no request can set them. If a sign up
      // request sends one anyway, Better Auth uses the default instead.
      additionalFields: {
        role: { type: ["USER", "ADMIN"], defaultValue: "USER", input: false },
        badge: { type: ["SPECTATOR", "ASSISTANT_REF", "CHIEF_VAR"], defaultValue: "SPECTATOR", input: false },
        tacticalIqScore: { type: "number", defaultValue: 50, input: false },
      },
      // Fans can delete their account (password rule in checkDeleteUser).
      deleteUser: { enabled: true },
    },

    session: {
      expiresIn: 30 * ONE_DAY_IN_SECONDS, // A session lasts 30 days
      updateAge: ONE_DAY_IN_SECONDS, // and is renewed at most once a day
    },

    advanced: {
      // only read the header app.ts just rewrote from req.ip
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },

    rateLimit: {
      // Better Auth only limits in production unless we turn it on.
      enabled: true,
      storage: "memory",
      // Better Auth's own default is stricter (3 per 10 seconds),
      // so we set the spec's numbers for these routes.
      customRules: {
        "/sign-up/email": tenPerMinute,
        "/sign-in/*": tenPerMinute,
        "/request-password-reset": tenPerMinute,
        "/reset-password": tenPerMinute,
        "/reset-password/*": tenPerMinute,
      },
    },

    plugins: [
      username({
        minUsernameLength: 3, // 3 to 20 characters
        maxUsernameLength: 20,
        usernameValidator: isAllowedUsername,
        immutableUsername: true,
      }),
    ],

    hooks: {
      before: runExtraChecks,
    },
  });
}

// The type of the object createAuth returns. Other files use it in their types.
export type Auth = ReturnType<typeof createAuth>;
