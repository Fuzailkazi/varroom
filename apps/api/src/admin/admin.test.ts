import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { prisma } from "@varroom/db/client";
import { recordAiCall } from "@varroom/db";
import type { NewAiCall } from "@varroom/db";
import { AdminReviewTraceResponse, ErrorResponse } from "@varroom/shared";
import { getLastEmail } from "../auth/email.ts";
import { Fan, newFanDetails } from "../testing/fan.ts";
import { startTestServer } from "../testing/server.ts";

// integration tests for the admin trace endpoint: the real endpoint and db
// (neon test branch). skipped without a database

const hasTestDatabase = Boolean(process.env.DATABASE_URL);

let server: Server;
let baseUrl: string;

// reviews this file leaves QUEUED. they're failed at the end, so they don't hold
// part of the daily budget in later test files
const liveReviewIds: string[] = [];

beforeAll(async () => {
  if (!hasTestDatabase) return;
  const started = await startTestServer();
  server = started.server;
  baseUrl = started.baseUrl;
});

afterAll(async () => {
  if (server) server.close();
  if (!hasTestDatabase) return;
  await prisma.review.updateMany({
    where: { id: { in: liveReviewIds }, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", failureReason: "internal: test cleanup" },
  });
});

// helpers

type TestFan = { fan: Fan; userId: string };

// a signed in fan with a confirmed email
async function newFan(): Promise<TestFan> {
  const fan = new Fan(baseUrl);
  const details = newFanDetails();
  const signUp = await fan.call("/api/auth/sign-up/email", { body: details });
  expect(signUp.status).toBe(200);

  const email = getLastEmail(details.email);
  expect(email).toBeDefined();
  await fetch(email!.url, { redirect: "manual" });

  const user = await prisma.user.findUniqueOrThrow({ where: { email: details.email } });
  return { fan: fan, userId: user.id };
}

async function newAdmin(): Promise<TestFan> {
  const admin = await newFan();
  await prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
  return admin;
}

// a debate with a QUEUED review, saved straight into the db. returns both ids
async function newReview(authorId: string): Promise<{ debateId: string; reviewId: string }> {
  const debate = await prisma.debate.create({
    data: {
      authorId: authorId,
      title: "Saka as a 9",
      thesis: "Saka is better as a 9 than on the wing.",
      categories: ["OTHER"],
    },
    select: { id: true },
  });
  const review = await prisma.review.create({
    data: { debateId: debate.id, status: "QUEUED", model: "test-model", requestedById: authorId },
    select: { id: true },
  });
  liveReviewIds.push(review.id);
  return { debateId: debate.id, reviewId: review.id };
}

// one finished gemini attempt, with whatever fields a test wants to change
function call(overrides: Partial<NewAiCall> = {}): NewAiCall {
  return {
    step: "MODERATOR",
    attempt: 1,
    claimOrder: null,
    model: "test-model",
    status: "OK",
    error: null,
    usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 5 },
    durationMs: 850,
    startedAt: new Date(),
    ...overrides,
  };
}

function getTrace(fan: Fan, reviewId: string): Promise<Response> {
  return fan.call(`/api/admin/reviews/${reviewId}/trace`);
}

async function errorCode(response: Response): Promise<string> {
  const body = ErrorResponse.parse(await response.json());
  return body.error.code;
}

describe.skipIf(!hasTestDatabase)("GET /api/admin/reviews/:id/trace", () => {
  test("an admin gets the review's totals and every call in time order, raw errors included", async () => {
    const { fan, userId } = await newAdmin();
    const { debateId, reviewId } = await newReview(userId);
    await recordAiCall(reviewId, call({ step: "MODERATOR", startedAt: new Date("2026-09-28T10:00:01Z") }));
    await recordAiCall(
      reviewId,
      call({
        step: "SEARCH",
        claimOrder: 1,
        status: "ERROR",
        error: "Gemini error 503: high demand",
        usage: null,
        durationMs: 1234,
        startedAt: new Date("2026-09-28T10:00:02Z"),
      }),
    );
    await recordAiCall(
      reviewId,
      call({ step: "SEARCH", attempt: 2, claimOrder: 1, startedAt: new Date("2026-09-28T10:00:05Z") }),
    );

    const response = await getTrace(fan, reviewId);

    expect(response.status).toBe(200);
    const body = AdminReviewTraceResponse.parse(await response.json());
    expect(body.review.id).toBe(reviewId);
    expect(body.review.debateId).toBe(debateId);
    expect(body.review.status).toBe("QUEUED");
    expect(body.review.startedAt).toBeNull();
    expect(body.review.completedAt).toBeNull();
    expect(body.review.aiCallCount).toBe(3);
    expect(body.review.inputTokens).toBe(200);
    expect(body.review.outputTokens).toBe(40);
    expect(body.review.thinkingTokens).toBe(10);
    expect(body.review.callsDeleted).toBe(false);

    expect(body.calls).toHaveLength(3);
    expect(body.calls[0]!.step).toBe("MODERATOR");
    expect(body.calls[0]!.claimOrder).toBeNull();
    expect(body.calls[1]).toEqual({
      step: "SEARCH",
      attempt: 1,
      claimOrder: 1,
      model: "test-model",
      status: "ERROR",
      error: "Gemini error 503: high demand",
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      durationMs: 1234,
      startedAt: "2026-09-28T10:00:02.000Z",
    });
    expect(body.calls[2]!.attempt).toBe(2);
    expect(body.calls[2]!.status).toBe("OK");
  });

  test("when the calls were cleaned up, an admin still gets the totals and callsDeleted is true", async () => {
    const { fan, userId } = await newAdmin();
    const { reviewId } = await newReview(userId);
    await recordAiCall(reviewId, call());
    await recordAiCall(reviewId, call({ step: "FACT_CHECKER" }));
    await prisma.aiCall.deleteMany({ where: { reviewId: reviewId } });

    const response = await getTrace(fan, reviewId);

    expect(response.status).toBe(200);
    const body = AdminReviewTraceResponse.parse(await response.json());
    expect(body.calls).toEqual([]);
    expect(body.review.aiCallCount).toBe(2);
    expect(body.review.inputTokens).toBe(200);
    expect(body.review.callsDeleted).toBe(true);
  });

  test("an admin gets 404 for a review that doesn't exist", async () => {
    const { fan } = await newAdmin();

    const response = await getTrace(fan, crypto.randomUUID());

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
  });

  test("an admin gets 404 for a malformed id", async () => {
    const { fan } = await newAdmin();

    const response = await getTrace(fan, "not-a-uuid");

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
  });

  test("a normal fan gets 403, even for their own review", async () => {
    const { fan, userId } = await newFan();
    const { reviewId } = await newReview(userId);

    const response = await getTrace(fan, reviewId);

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("FORBIDDEN");
  });

  test("a normal fan gets 403 for an unknown id too, so they can't tell which ids exist", async () => {
    const { fan } = await newFan();

    const response = await getTrace(fan, crypto.randomUUID());

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("FORBIDDEN");
  });

  test("signed out gets 401, before the id is even looked at", async () => {
    const { userId } = await newFan();
    const { reviewId } = await newReview(userId);
    const stranger = new Fan(baseUrl);

    const known = await getTrace(stranger, reviewId);
    const malformed = await getTrace(stranger, "not-a-uuid");

    expect(known.status).toBe(401);
    expect(await errorCode(known)).toBe("UNAUTHENTICATED");
    expect(malformed.status).toBe(401);
    expect(await errorCode(malformed)).toBe("UNAUTHENTICATED");
  });
});
