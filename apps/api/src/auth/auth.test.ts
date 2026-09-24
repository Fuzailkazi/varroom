import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { prisma } from "@varroom/db/client";
import { ErrorResponse, MeResponse } from "@varroom/shared";
import { loadEnv } from "../env.ts";
import { Fan, newFanDetails } from "../testing/fan.ts";
import { startTestServer } from "../testing/server.ts";
import { createAuth } from "./auth.ts";
import { getLastEmail } from "./email.ts";
import { requireRole } from "./guards.ts";

// Integration tests for sign in. They run against the Neon
// `test` branch, which the test preload wipes before every run.
// Without DATABASE_URL_TEST in .env, they are skipped.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const hasTestDatabase = Boolean(process.env.DATABASE_URL);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  if (!hasTestDatabase) return;
  const started = await startTestServer();
  server = started.server;
  baseUrl = started.baseUrl;
});

afterAll(() => {
  if (server) server.close();
});

// small helpers so the tests below stay short

// Sign up details, plus any extra fields a test wants to send.
type SignUpBody = ReturnType<typeof newFanDetails> & Record<string, unknown>;

async function signUp(fan: Fan, details: SignUpBody = newFanDetails()) {
  const response = await fan.call("/api/auth/sign-up/email", { body: details });
  return { response, details };
}

async function signInWithEmail(fan: Fan, email: string, password: string) {
  return fan.call("/api/auth/sign-in/email", { body: { email, password } });
}

async function signInWithUsername(fan: Fan, username: string, password: string) {
  return fan.call("/api/auth/sign-in/username", { body: { username, password } });
}

// Calls GET /api/me and returns the status and the parsed profile.
async function getMe(fan: Fan) {
  const response = await fan.call("/api/me");
  if (response.status !== 200) {
    return { status: response.status, profile: undefined };
  }
  const profile = MeResponse.parse(await response.json());
  return { status: response.status, profile };
}

// The "code" of an error from OUR routes: { error: { code, message } }
async function ourErrorCode(response: Response) {
  const body = ErrorResponse.parse(await response.json());
  return body.error.code;
}

// The "code" of an error from BETTER AUTH's routes: { code, message }
async function betterAuthErrorCode(response: Response) {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

// Opens the link in the newest confirmation email, like clicking it.
async function clickConfirmationLink(email: string) {
  const sent = getLastEmail(email);
  expect(sent).toBeDefined();
  const response = await fetch(sent!.url, { redirect: "manual" });
  // Better Auth answers 302 (a redirect back to the site) when it worked.
  expect([200, 302]).toContain(response.status);
}

function randomMissingEmail() {
  return `nobody.${newFanDetails().tag}@test.varroom.dev`;
}

// the tests

describe.skipIf(!hasTestDatabase)("sign in", () => {
  describe("sign up, confirm, then write", () => {
    test("a new fan is signed in, unconfirmed, and unlocked by the email link", async () => {
      const fan = new Fan(baseUrl);
      const details = newFanDetails();

      // Sign up with spaces around the display name.
      const { response } = await signUp(fan, { ...details, name: `  ${details.name}  ` });
      expect(response.status).toBe(200);
      expect(fan.hasSession()).toBe(true);

      // The profile shows the defaults and an unconfirmed email.
      const before = await getMe(fan);
      expect(before.status).toBe(200);
      expect(before.profile).toMatchObject({
        username: details.username,
        displayName: details.name, // the spaces were trimmed
        email: details.email,
        emailVerified: false,
        role: "USER",
        badge: "SPECTATOR",
        tacticalIqScore: 50,
      });

      // A "verified only" route refuses the fan for now.
      const blocked = await fan.call("/api/_test/verified-ping", { body: {} });
      expect(blocked.status).toBe(403);
      expect(await ourErrorCode(blocked)).toBe("EMAIL_NOT_VERIFIED");

      // After clicking the link, the same request works.
      await clickConfirmationLink(details.email);
      const allowed = await fan.call("/api/_test/verified-ping", { body: {} });
      expect(allowed.status).toBe(200);

      const after = await getMe(fan);
      expect(after.profile?.emailVerified).toBe(true);
    });

    test("a verified only route answers 401 in our error shape without a session", async () => {
      const stranger = new Fan(baseUrl);
      const response = await stranger.call("/api/_test/verified-ping", { body: {} });
      expect(response.status).toBe(401);
      expect(await ourErrorCode(response)).toBe("UNAUTHENTICATED");
    });
  });

  describe("sign up rules", () => {
    test("refuses an empty display name", async () => {
      const { response } = await signUp(new Fan(baseUrl), { ...newFanDetails(), name: "   " });
      expect(response.status).toBe(400);
      expect(await betterAuthErrorCode(response)).toBe("INVALID_DISPLAY_NAME");
    });

    test("refuses a display name over 50 characters", async () => {
      const { response } = await signUp(new Fan(baseUrl), { ...newFanDetails(), name: "x".repeat(51) });
      expect(response.status).toBe(400);
      expect(await betterAuthErrorCode(response)).toBe("INVALID_DISPLAY_NAME");
    });

    test("refuses a password shorter than 8 characters", async () => {
      const { response } = await signUp(new Fan(baseUrl), { ...newFanDetails(), password: "short7!" });
      expect(response.status).toBe(400);
    });

    test("refuses a password longer than 128 characters", async () => {
      const { response } = await signUp(new Fan(baseUrl), { ...newFanDetails(), password: "p".repeat(129) });
      expect(response.status).toBe(400);
    });

    test("refuses a sign up without a username", async () => {
      const details = newFanDetails();
      const body = { email: details.email, password: details.password, name: details.name };
      const response = await new Fan(baseUrl).call("/api/auth/sign-up/email", { body });
      expect(response.status).toBe(400);
      expect(await betterAuthErrorCode(response)).toBe("USERNAME_REQUIRED");
    });
  });

  describe("usernames", () => {
    test("names that differ only in letter case count as the same name", async () => {
      const tag = newFanDetails().tag;

      const first = await signUp(new Fan(baseUrl), { ...newFanDetails(), username: `jf_${tag}` });
      expect(first.response.status).toBe(200);

      const second = await signUp(new Fan(baseUrl), { ...newFanDetails(), username: `JF_${tag.toUpperCase()}` });
      expect(second.response.status).toBe(400);
      expect(await betterAuthErrorCode(second.response)).toBe("USERNAME_IS_ALREADY_TAKEN");
    });

    test("stores the name lowercase and keeps the typed form for display", async () => {
      const fan = new Fan(baseUrl);
      const details = newFanDetails();
      const typed = `Jude_${details.tag}`;

      // Also tries to sneak in a different display name, which is ignored.
      await signUp(fan, { ...details, username: typed, displayUsername: "admin" });

      const { profile } = await getMe(fan);
      expect(profile?.username).toBe(typed.toLowerCase());
      expect(profile?.displayUsername).toBe(typed);
    });

    const badUsernames = ["Admin", "VARROOM", "deleted", "ab", "a".repeat(21), "jude-fan", "jude fan"];
    for (const badName of badUsernames) {
      test(`refuses the username "${badName}"`, async () => {
        const { response } = await signUp(new Fan(baseUrl), { ...newFanDetails(), username: badName });
        expect(response.status).toBe(400);
        const code = await betterAuthErrorCode(response);
        expect(["INVALID_USERNAME", "USERNAME_TOO_SHORT", "USERNAME_TOO_LONG"]).toContain(code!);
      });
    }

    test("a username can never be changed", async () => {
      const fan = new Fan(baseUrl);
      await signUp(fan);

      const newName = `new_${newFanDetails().tag}`;
      const changeName = await fan.call("/api/auth/update-user", { body: { username: newName } });
      expect(changeName.status).toBe(400);
      expect(await betterAuthErrorCode(changeName)).toBe("USERNAME_IS_IMMUTABLE");

      const changeDisplay = await fan.call("/api/auth/update-user", { body: { displayUsername: "Someone_Else" } });
      expect(changeDisplay.status).toBe(400);
      expect(await betterAuthErrorCode(changeDisplay)).toBe("USERNAME_IS_IMMUTABLE");
    });
  });

  describe("signing in", () => {
    test("works with email plus password", async () => {
      const { details } = await signUp(new Fan(baseUrl));

      const laptop = new Fan(baseUrl);
      const response = await signInWithEmail(laptop, details.email, details.password);
      expect(response.status).toBe(200);
      expect((await getMe(laptop)).status).toBe(200);
    });

    test("works with username (in any letter case) plus password", async () => {
      const { details } = await signUp(new Fan(baseUrl));

      const laptop = new Fan(baseUrl);
      const response = await signInWithUsername(laptop, details.username.toUpperCase(), details.password);
      expect(response.status).toBe(200);
      expect((await getMe(laptop)).status).toBe(200);
    });

    test("a wrong email and a wrong password get the exact same 401", async () => {
      const { details } = await signUp(new Fan(baseUrl));

      const wrongPassword = await signInWithEmail(new Fan(baseUrl), details.email, "not-the-password");
      const unknownEmail = await signInWithEmail(new Fan(baseUrl), randomMissingEmail(), details.password);

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
    });

    test("a wrong username and a wrong password get the exact same 401", async () => {
      const { details } = await signUp(new Fan(baseUrl));

      const wrongPassword = await signInWithUsername(new Fan(baseUrl), details.username, "not-the-password");
      const unknownName = await signInWithUsername(new Fan(baseUrl), `x_${details.tag}`, details.password);

      expect(wrongPassword.status).toBe(401);
      expect(unknownName.status).toBe(401);
      expect(await wrongPassword.json()).toEqual(await unknownName.json());
    });
  });

  describe("fields only the server may set", () => {
    test("sign up ignores role, badge and tactical IQ sent in the body", async () => {
      const fan = new Fan(baseUrl);
      await signUp(fan, { ...newFanDetails(), role: "ADMIN", badge: "CHIEF_VAR", tacticalIqScore: 100 });

      const { profile } = await getMe(fan);
      expect(profile?.role).toBe("USER");
      expect(profile?.badge).toBe("SPECTATOR");
      expect(profile?.tacticalIqScore).toBe(50);
    });

    test("updating your own role is refused", async () => {
      const fan = new Fan(baseUrl);
      await signUp(fan);

      const response = await fan.call("/api/auth/update-user", { body: { role: "ADMIN" } });
      expect(response.status).toBe(400);

      const { profile } = await getMe(fan);
      expect(profile?.role).toBe("USER");
    });
  });

  describe("sessions", () => {
    // Finds the session row of the fan with this email (they have one).
    function findSession(email: string) {
      return prisma.session.findFirstOrThrow({ where: { user: { email: email } } });
    }

    test("a session lasts 30 days", async () => {
      const { details } = await signUp(new Fan(baseUrl));
      const session = await findSession(details.email);

      const timeLeft = session.expiresAt.getTime() - Date.now();
      expect(timeLeft).toBeGreaterThan(29.9 * ONE_DAY_MS);
    });

    test("is not renewed within the first day", async () => {
      const fan = new Fan(baseUrl);
      const { details } = await signUp(fan);
      const before = await findSession(details.email);

      await getMe(fan);

      const after = await findSession(details.email);
      expect(after.expiresAt).toEqual(before.expiresAt);
    });

    test("is renewed to 30 days once a day has passed", async () => {
      const fan = new Fan(baseUrl);
      const { details } = await signUp(fan);
      const session = await findSession(details.email);

      // Pretend the session was created two days ago (28 days left).
      const twoDaysEarlier = new Date(session.expiresAt.getTime() - 2 * ONE_DAY_MS);
      await prisma.session.update({ where: { id: session.id }, data: { expiresAt: twoDaysEarlier } });

      await fan.call("/api/auth/get-session");

      const renewed = await findSession(details.email);
      const timeLeft = renewed.expiresAt.getTime() - Date.now();
      expect(timeLeft).toBeGreaterThan(29.9 * ONE_DAY_MS);
    });

    test("an expired session is refused", async () => {
      const fan = new Fan(baseUrl);
      const { details } = await signUp(fan);

      const oneSecondAgo = new Date(Date.now() - 1000);
      await prisma.session.updateMany({
        where: { user: { email: details.email } },
        data: { expiresAt: oneSecondAgo },
      });

      expect((await getMe(fan)).status).toBe(401);
    });

    test("sign out ends only the current device's session", async () => {
      const phone = new Fan(baseUrl);
      const { details } = await signUp(phone);
      const laptop = phone.otherDevice();
      await signInWithEmail(laptop, details.email, details.password);

      const response = await phone.call("/api/auth/sign-out", { body: {} });
      expect(response.status).toBe(200);

      expect((await getMe(phone)).status).toBe(401);
      expect((await getMe(laptop)).status).toBe(200);
    });

    test("sign out everywhere ends every session", async () => {
      const phone = new Fan(baseUrl);
      const { details } = await signUp(phone);
      const laptop = phone.otherDevice();
      await signInWithEmail(laptop, details.email, details.password);

      const response = await phone.call("/api/auth/revoke-sessions", { body: {} });
      expect(response.status).toBe(200);

      expect((await getMe(phone)).status).toBe(401);
      expect((await getMe(laptop)).status).toBe(401);
    });
  });

  describe("confirmation email again, and password reset", () => {
    test("a fan can ask for the confirmation link again", async () => {
      const fan = new Fan(baseUrl);
      const { details } = await signUp(fan);
      const firstEmail = getLastEmail(details.email);

      const response = await fan.call("/api/auth/send-verification-email", { body: { email: details.email } });
      expect(response.status).toBe(200);

      const secondEmail = getLastEmail(details.email);
      expect(secondEmail).not.toBe(firstEmail);

      await clickConfirmationLink(details.email);
      expect((await getMe(fan)).profile?.emailVerified).toBe(true);
    });

    test("a reset link sets a new password and signs out every device", async () => {
      const phone = new Fan(baseUrl);
      const { details } = await signUp(phone);

      // 1. Ask for a reset link (from another device, signed out).
      const helper = new Fan(baseUrl);
      const request = await helper.call("/api/auth/request-password-reset", { body: { email: details.email } });
      expect(request.status).toBe(200);

      // 2. The link looks like .../reset-password/<token>?callbackURL=...
      const link = getLastEmail(details.email)!.url;
      const afterPath = link.split("/reset-password/")[1]!;
      const token = afterPath.split("?")[0];

      // 3. Set a new password with that token.
      const newPassword = details.password + "-new";
      const reset = await helper.call("/api/auth/reset-password", { body: { token, newPassword } });
      expect(reset.status).toBe(200);

      // The phone was signed out, the old password fails, the new one works.
      expect((await getMe(phone)).status).toBe(401);
      const withOldPassword = await signInWithEmail(new Fan(baseUrl), details.email, details.password);
      expect(withOldPassword.status).toBe(401);
      const withNewPassword = await signInWithEmail(new Fan(baseUrl), details.email, newPassword);
      expect(withNewPassword.status).toBe(200);
    });
  });

  describe("deleting an account", () => {
    test("needs the right password, then removes the user but keeps their debates", async () => {
      const fan = new Fan(baseUrl);
      const { details } = await signUp(fan);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: details.email } });
      const debate = await prisma.debate.create({
        data: { authorId: user.id, title: "Test debate", thesis: "Rice is a better 6 than an 8." },
      });

      // No password: refused.
      const noPassword = await fan.call("/api/auth/delete-user", { body: {} });
      expect(noPassword.status).toBe(400);
      expect(await betterAuthErrorCode(noPassword)).toBe("PASSWORD_REQUIRED");

      // Wrong password: refused.
      const wrongPassword = await fan.call("/api/auth/delete-user", { body: { password: "wrong-password" } });
      expect(wrongPassword.status).toBe(400);

      // Right password: deleted.
      const deleted = await fan.call("/api/auth/delete-user", { body: { password: details.password } });
      expect(deleted.status).toBe(200);

      // The user, their sessions and their sign in details are gone...
      expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
      expect((await getMe(fan)).status).toBe(401);

      // ...but the debate stays, with no author.
      const keptDebate = await prisma.debate.findUniqueOrThrow({ where: { id: debate.id } });
      expect(keptDebate.authorId).toBeNull();
    });
  });

  describe("rate limits", () => {
    test("the 11th sign in attempt within a minute from one IP answers 429", async () => {
      const fan = new Fan(baseUrl);
      const email = randomMissingEmail();

      // The first 10 attempts get the normal "wrong details" answer.
      for (let attempt = 1; attempt <= 10; attempt++) {
        const response = await signInWithEmail(fan, email, "whatever-it-is");
        expect(response.status).toBe(401);
      }

      // The 11th is blocked.
      const eleventh = await signInWithEmail(fan, email, "whatever-it-is");
      expect(eleventh.status).toBe(429);

      // A fan on a different IP is not affected.
      const otherFan = new Fan(baseUrl);
      const response = await signInWithEmail(otherFan, email, "whatever-it-is");
      expect(response.status).toBe(401);
    });

    test("password reset requests are limited too", async () => {
      const fan = new Fan(baseUrl);
      const body = { email: randomMissingEmail() };

      for (let attempt = 1; attempt <= 10; attempt++) {
        await fan.call("/api/auth/request-password-reset", { body });
      }
      const eleventh = await fan.call("/api/auth/request-password-reset", { body });
      expect(eleventh.status).toBe(429);
    });
  });

  describe("requireRole (for moderation later, feature 15)", () => {
    test("lets admins through and answers 403 FORBIDDEN to everyone else", async () => {
      // No admin route exists yet, so we build a tiny app with one,
      // using the same Better Auth setup and the same database.
      const env = loadEnv({
        ...process.env,
        NODE_ENV: "test",
        BETTER_AUTH_URL: baseUrl,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "test-secret-that-is-at-least-32-characters",
      });
      const adminApp = express();
      adminApp.locals.auth = createAuth(env, async () => {});
      adminApp.get("/admin", requireRole("ADMIN"), (_req, res) => {
        res.json({ ok: true });
      });
      const adminServer = adminApp.listen(0);
      const adminPort = (adminServer.address() as AddressInfo).port;

      // A normal fan signs up on the main app...
      const fan = new Fan(baseUrl);
      const { details } = await signUp(fan);

      // ...and sends the same cookie to the admin route.
      async function openAdminPage() {
        const url = `http://localhost:${adminPort}/admin`;
        return fetch(url, { headers: { Cookie: fan.cookieHeader() } });
      }

      const refused = await openAdminPage();
      expect(refused.status).toBe(403);
      expect(await ourErrorCode(refused)).toBe("FORBIDDEN");

      // Make them an admin by hand (the spec says the first admin is set this way).
      await prisma.user.update({ where: { email: details.email }, data: { role: "ADMIN" } });
      const allowed = await openAdminPage();
      expect(allowed.status).toBe(200);

      adminServer.close();
    });
  });
});
