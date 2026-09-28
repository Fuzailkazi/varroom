import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { prisma } from "@varroom/db/client";
import { ErrorResponse } from "@varroom/shared";
import { Fan } from "../testing/fan.ts";
import { startTestServer } from "../testing/server.ts";
import { DEFAULT_RATE_LIMITS } from "./rateLimit.ts";

// integration tests for the per ip rate limits on the public review reads.
// this file starts its own server with the real limits (60 reads and 20 stream
// opens a minute), every other test file runs with limits too high to ever trip.
//
// the counter is a one minute window, and a real verdict read takes a few database
// round trips. 60 of them could take longer than a minute, so the window would start
// over halfway. so most requests use a malformed id: it's counted by the limiter like
// any other request, then answers 404 straight away without touching the database

const hasTestDatabase = Boolean(process.env.DATABASE_URL);

// not a uuid, so the route answers 404 without a database read
const MALFORMED_ID = "not-a-review-id";

let server: Server;
let baseUrl: string;

// a finished (failed) review, so its stream sends one final event and closes straight away
let reviewId: string;

beforeAll(async () => {
  if (!hasTestDatabase) return;
  const started = await startTestServer({}, {}, DEFAULT_RATE_LIMITS);
  server = started.server;
  baseUrl = started.baseUrl;

  const user = await prisma.user.create({
    data: {
      id: `rate-limit-test-${crypto.randomUUID()}`,
      email: `rate-limit-test-${crypto.randomUUID()}@varroom.test`,
      name: "Rate Limit Test",
    },
  });
  const debate = await prisma.debate.create({
    data: {
      authorId: user.id,
      title: "Saka as a 9",
      thesis: "Saka is better as a 9 than on the wing.",
      categories: ["OTHER"],
    },
    select: { id: true },
  });
  const review = await prisma.review.create({
    data: { debateId: debate.id, status: "FAILED", failureReason: "timeout: test review" },
    select: { id: true },
  });
  reviewId = review.id;
});

afterAll(() => {
  if (server) server.close();
});

// helpers

// fixed test ips (a documentation range), one per test so the counters never mix
function visitor(ip: string): Fan {
  return new Fan(baseUrl, ip);
}

// sends the same request `times` times and returns every status code.
// the body is always read, so each connection is done before the next request
async function callMany(fan: Fan, path: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) {
    const response = await fan.call(path);
    await response.text();
    statuses.push(response.status);
  }
  return statuses;
}

// checks every status in the list is the expected one
function expectAll(statuses: number[], expected: number) {
  for (const status of statuses) {
    expect(status).toBe(expected);
  }
}

// checks a response is our usual RATE_LIMITED json error with a Retry-After header
async function expectRateLimited(response: Response) {
  expect(response.status).toBe(429);
  expect(response.headers.get("content-type")).toContain("application/json");

  const retryAfter = Number(response.headers.get("retry-after"));
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(retryAfter).toBeLessThanOrEqual(60);

  const body = ErrorResponse.parse(await response.json());
  expect(body.error.code).toBe("RATE_LIMITED");
}

describe.skipIf(!hasTestDatabase)("rate limit on GET /api/reviews/:id", () => {
  test("60 verdict requests a minute are fine, the 61st gets 429 RATE_LIMITED", async () => {
    const fan = visitor("203.0.113.1");

    // one real verdict, then 59 quick ones: 60 in total
    const first = await fan.call(`/api/reviews/${reviewId}`);
    await first.text();
    expect(first.status).toBe(200);
    expectAll(await callMany(fan, `/api/reviews/${MALFORMED_ID}`, 59), 404);

    // the 61st, for the real review this time
    const blocked = await fan.call(`/api/reviews/${reviewId}`);
    await expectRateLimited(blocked);
  });

  test("a different ip still gets 200 while the first one is blocked", async () => {
    const first = visitor("203.0.113.2");
    expectAll(await callMany(first, `/api/reviews/${MALFORMED_ID}`, 60), 404);
    const stillBlocked = await first.call(`/api/reviews/${reviewId}`);
    expect(stillBlocked.status).toBe(429);
    await stillBlocked.text();

    const second = visitor("203.0.113.3");
    const response = await second.call(`/api/reviews/${reviewId}`);

    expect(response.status).toBe(200);
    await response.text();
  });

  test("two ipv6 addresses in the same network get their own counters", async () => {
    // both are in 2001:db8::/56, which the library would count as one visitor by default
    const first = visitor("2001:db8:0:1::1");
    expectAll(await callMany(first, `/api/reviews/${MALFORMED_ID}`, 60), 404);
    const stillBlocked = await first.call(`/api/reviews/${reviewId}`);
    expect(stillBlocked.status).toBe(429);
    await stillBlocked.text();

    const neighbour = visitor("2001:db8:0:2::1");
    const response = await neighbour.call(`/api/reviews/${reviewId}`);

    expect(response.status).toBe(200);
    await response.text();
  });

  test("the limit runs before the database: once over it, an unknown id gets 429, not 404", async () => {
    const fan = visitor("203.0.113.4");
    expectAll(await callMany(fan, `/api/reviews/${MALFORMED_ID}`, 60), 404);

    // this id would need a database lookup to answer 404, the limiter answers first
    const blocked = await fan.call(`/api/reviews/${crypto.randomUUID()}`);
    await expectRateLimited(blocked);
  });

  test("sends the standard RateLimit headers and not the old X-RateLimit ones", async () => {
    const fan = visitor("203.0.113.5");

    const response = await fan.call(`/api/reviews/${reviewId}`);
    await response.text();

    expect(response.headers.get("ratelimit-policy")).not.toBeNull();
    expect(response.headers.get("ratelimit")).not.toBeNull();
    expect(response.headers.get("x-ratelimit-limit")).toBeNull();
    expect(response.headers.get("x-ratelimit-remaining")).toBeNull();
  });
});

describe.skipIf(!hasTestDatabase)("rate limit on GET /api/reviews/availability", () => {
  test("availability shares the verdict counter: 59 verdicts use it up with 1 availability", async () => {
    const fan = visitor("203.0.113.10");

    expectAll(await callMany(fan, `/api/reviews/${MALFORMED_ID}`, 59), 404);
    const lastAllowed = await fan.call("/api/reviews/availability");
    await lastAllowed.text();
    expect(lastAllowed.status).toBe(200);

    // the 61st request of the minute, whichever route it goes to
    const blockedAvailability = await fan.call("/api/reviews/availability");
    await expectRateLimited(blockedAvailability);
    const blockedVerdict = await fan.call(`/api/reviews/${reviewId}`);
    await expectRateLimited(blockedVerdict);
  });

  test("availability requests count toward verdict reads too", async () => {
    const fan = visitor("203.0.113.11");

    expectAll(await callMany(fan, "/api/reviews/availability", 3), 200);
    expectAll(await callMany(fan, `/api/reviews/${MALFORMED_ID}`, 57), 404);

    const blocked = await fan.call(`/api/reviews/${MALFORMED_ID}`);
    await expectRateLimited(blocked);
  });
});

describe.skipIf(!hasTestDatabase)("rate limit on GET /api/reviews/:id/events", () => {
  test("20 stream opens a minute are fine, the 21st gets a 429 json error and no stream", async () => {
    const fan = visitor("203.0.113.20");

    // one real stream, then 19 quick ones (a malformed id answers 404 before any stream starts)
    const first = await fan.call(`/api/reviews/${reviewId}/events`);
    expect(first.headers.get("content-type")).toContain("text/event-stream");
    await first.text();
    expect(first.status).toBe(200);
    expectAll(await callMany(fan, `/api/reviews/${MALFORMED_ID}/events`, 19), 404);

    const blocked = await fan.call(`/api/reviews/${reviewId}/events`);
    expect(blocked.headers.get("content-type")).not.toContain("text/event-stream");
    await expectRateLimited(blocked);
  });

  test("stream opens have their own counter, so verdict reads still work after 20 streams", async () => {
    const fan = visitor("203.0.113.21");
    await callMany(fan, `/api/reviews/${MALFORMED_ID}/events`, 21);

    const response = await fan.call(`/api/reviews/${reviewId}`);

    expect(response.status).toBe(200);
    await response.text();
  });

  test("a different ip can still open a stream while the first one is blocked", async () => {
    const first = visitor("203.0.113.22");
    expectAll(await callMany(first, `/api/reviews/${MALFORMED_ID}/events`, 20), 404);
    const stillBlocked = await first.call(`/api/reviews/${reviewId}/events`);
    expect(stillBlocked.status).toBe(429);
    await stillBlocked.text();

    const second = visitor("203.0.113.23");
    const response = await second.call(`/api/reviews/${reviewId}/events`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.text();
  });
});
