import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { prisma } from "@varroom/db/client";
import { getBudgetStatus } from "@varroom/db";
import type { AgentReply, RunAgentFn, SearchReply, SearchWebFn, TokenUsage, WebSource } from "@varroom/agents";
import { AvailabilityResponse, ErrorResponse, ReviewResponse, StartReviewResponse } from "@varroom/shared";
import { getLastEmail } from "../auth/email.ts";
import { Fan, newFanDetails } from "../testing/fan.ts";
import { startTestServer } from "../testing/server.ts";
import { createReviewRunner, recoverInterruptedReviews } from "./runner.ts";
import type { StreamMessage } from "./response.ts";

// integration tests for the review api: real endpoints and db (neon test branch),
// fake agents and fake search so no gemini calls. skipped without DATABASE_URL_TEST

const hasTestDatabase = Boolean(process.env.DATABASE_URL);

// fake agents

// builds what one fake agent attempt returns: the json as text, plus optional token usage
function reply(json: object, usage: TokenUsage | null = null): AgentReply {
  return { text: JSON.stringify(json), usage: usage };
}

// builds what one fake search attempt returns
function found(sources: WebSource[], usage: TokenUsage | null = null): SearchReply {
  return { sources: sources, usage: usage };
}

const moderatorOutput = {
  claims: [
    {
      order: 1,
      claimText: "Bellingham is better as a false 9 than as an 8",
      type: "POSITIONAL_ROLE",
      entities: { player: "Bellingham", positionA: "false 9", positionB: "8" },
    },
    {
      order: 2,
      claimText: "Real Madrid should sign Haaland",
      type: "UNTESTABLE",
      entities: { player: "", positionA: "" },
    },
  ],
};

const factCheckerOutput = {
  verdicts: [{ claimOrder: 1, verdict: "VERIFIED", reasoning: "Both sites agree.", citedLabels: ["E1", "E2"] }],
};

// a gate is a promise the test opens when it's ready, to pause the fake agents mid review
type Gate = { promise: Promise<void>; open: () => void };

function makeGate(): Gate {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise: promise, open: open };
}

// the moderator's answer when every claim is an opinion, so nothing can be checked
const untestableOnlyOutput = {
  claims: [
    {
      order: 1,
      claimText: "Real Madrid should sign Haaland",
      type: "UNTESTABLE",
      entities: { player: "", positionA: "" },
    },
  ],
};

// what the fakes should do in the current test. reset before each test
const control = {
  moderatorGate: null as Gate | null,
  factCheckerGate: null as Gate | null,
  searchFails: false,
  searchFindsNothing: false, // the search works but returns no sources
  moderatorAnswer: moderatorOutput as object, // swap in a different moderator answer
  moderatorInputs: [] as string[], // every text the moderator was asked to review
};

// the pipeline always starts the fact checker prompt with "Claims:", so route on that
const fakeAgents: RunAgentFn = async (_agent, input) => {
  if (input.startsWith("Claims:")) {
    if (control.factCheckerGate) {
      await control.factCheckerGate.promise;
    }
    return reply(factCheckerOutput);
  }
  control.moderatorInputs.push(input);
  if (control.moderatorGate) {
    await control.moderatorGate.promise;
  }
  return reply(control.moderatorAnswer);
};

const fakeSearch: SearchWebFn = async () => {
  if (control.searchFails) {
    throw new Error("Gemini error 429: quota exceeded for model xyz");
  }
  if (control.searchFindsNothing) {
    return found([]);
  }
  return found([
    { url: "https://whoscored.com/a", title: "whoscored.com", publishedAt: null },
    { url: "https://fotmob.com/b", title: "fotmob.com", publishedAt: null },
  ]);
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  if (!hasTestDatabase) return;
  // no wait between retries, so the failing search (a 429) doesn't slow the tests down
  const started = await startTestServer({ runAgentFn: fakeAgents, searchWebFn: fakeSearch, retryDelayMs: 0 });
  server = started.server;
  baseUrl = started.baseUrl;
});

afterAll(() => {
  if (server) server.close();
});

beforeEach(() => {
  control.moderatorGate = null;
  control.factCheckerGate = null;
  control.searchFails = false;
  control.searchFindsNothing = false;
  control.moderatorAnswer = moderatorOutput;
  control.moderatorInputs = [];
});

// helpers

type TestFan = { fan: Fan; userId: string };

async function newFan(url: string, confirmed: boolean): Promise<TestFan> {
  const fan = new Fan(url);
  const details = newFanDetails();
  const signUp = await fan.call("/api/auth/sign-up/email", { body: details });
  expect(signUp.status).toBe(200);

  if (confirmed) {
    const email = getLastEmail(details.email);
    expect(email).toBeDefined();
    await fetch(email!.url, { redirect: "manual" });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { email: details.email } });
  return { fan: fan, userId: user.id };
}

async function insertDebate(authorId: string): Promise<string> {
  const debate = await prisma.debate.create({
    data: {
      authorId: authorId,
      title: "Bellingham false 9",
      thesis: "Bellingham is more effective as a false 9 than as an 8.",
      categories: ["OTHER"],
    },
    select: { id: true },
  });
  return debate.id;
}

// our origin guard wants json on every post, so send an empty object
async function startReview(fan: Fan, debateId: string): Promise<Response> {
  return fan.call(`/api/debates/${debateId}/reviews`, { body: {} });
}

async function startAndReadId(fan: Fan, debateId: string): Promise<string> {
  const response = await startReview(fan, debateId);
  const body = StartReviewResponse.parse(await response.json());
  return body.review.id;
}

// polls the db until the review reaches a final status, or gives up after a few seconds
async function waitUntilEnded(reviewId: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { status: true } });
    if (review && (review.status === "COMPLETE" || review.status === "FAILED")) {
      return review.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`review ${reviewId} never ended`);
}

type SseMessage = { id: string | null; event: string; data: any };

// turns one raw sse block ("id: 5\nevent: x\ndata: {...}") into a message. null for comments
function parseSseBlock(block: string): SseMessage | null {
  let id: string | null = null;
  let event = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("id: ")) {
      id = line.slice(4);
    } else if (line.startsWith("event: ")) {
      event = line.slice(7);
    } else if (line.startsWith("data: ")) {
      data = line.slice(6);
    }
  }
  if (event === "") {
    return null;
  }
  return { id: id, event: event, data: JSON.parse(data) };
}

// reads an open sse response until the server closes it, or until `stopAfter` messages
async function readSse(response: Response, stopAfter: number | null = null): Promise<SseMessage[]> {
  const messages: SseMessage[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    pending = pending + decoder.decode(chunk.value, { stream: true });

    // messages end with a blank line
    let end = pending.indexOf("\n\n");
    while (end !== -1) {
      const message = parseSseBlock(pending.slice(0, end));
      pending = pending.slice(end + 2);
      if (message) {
        messages.push(message);
      }
      end = pending.indexOf("\n\n");
    }

    if (stopAfter !== null && messages.length >= stopAfter) {
      await reader.cancel();
      break;
    }
  }
  return messages;
}

function eventNames(messages: SseMessage[]): string[] {
  const names: string[] = [];
  for (const message of messages) {
    names.push(message.event);
  }
  return names;
}

function openStream(reviewId: string, lastEventId: string | null = null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (lastEventId !== null) {
    headers["Last-Event-ID"] = lastEventId;
  }
  return fetch(`${baseUrl}/api/reviews/${reviewId}/events`, { headers: headers });
}

async function errorOf(response: Response) {
  return ErrorResponse.parse(await response.json()).error;
}

const HOUR_MS = 60 * 60 * 1000;

// saves a review this fan started some hours ago, on a debate of its own. returns the review id
async function seedReview(userId: string, hoursAgo: number, status: "COMPLETE" | "FAILED" = "COMPLETE") {
  const debateId = await insertDebate(userId);
  const createdAt = new Date(Date.now() - hoursAgo * HOUR_MS);
  const review = await prisma.review.create({
    data: { debateId: debateId, status: status, requestedById: userId, createdAt: createdAt },
  });
  return { reviewId: review.id, createdAt: createdAt };
}

describe.skipIf(!hasTestDatabase)("POST /api/debates/:id/reviews", () => {
  test("a verified fan starts a review and gets its id back at once", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);

    const response = await startReview(fan, debateId);

    expect(response.status).toBe(202);
    const body = StartReviewResponse.parse(await response.json());
    expect(body.review.debateId).toBe(debateId);
    expect(body.review.status).toBe("QUEUED");

    const row = await prisma.review.findUniqueOrThrow({ where: { id: body.review.id } });
    expect(row.requestedById).toBe(userId);

    await waitUntilEnded(body.review.id);
  });

  test("asking again returns the same review and creates nothing new", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    const firstId = await startAndReadId(fan, debateId);
    await waitUntilEnded(firstId);

    const again = await startReview(fan, debateId);

    expect(again.status).toBe(200);
    const body = StartReviewResponse.parse(await again.json());
    expect(body.review.id).toBe(firstId);
    const count = await prisma.review.count({ where: { debateId: debateId } });
    expect(count).toBe(1);
  });

  test("two fans asking at the same moment end up with one review", async () => {
    const first = await newFan(baseUrl, true);
    const second = await newFan(baseUrl, true);
    const debateId = await insertDebate(first.userId);

    const responses = await Promise.all([startReview(first.fan, debateId), startReview(second.fan, debateId)]);

    const ids = new Set<string>();
    for (const response of responses) {
      const body = StartReviewResponse.parse(await response.json());
      ids.add(body.review.id);
    }
    expect(ids.size).toBe(1);
    const count = await prisma.review.count({ where: { debateId: debateId } });
    expect(count).toBe(1);

    for (const id of ids) {
      await waitUntilEnded(id);
    }
  });

  test("a debate whose review failed can be reviewed again", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    const failed = await prisma.review.create({
      data: { debateId: debateId, status: "FAILED", failureReason: "search: outage" },
    });

    const response = await startReview(fan, debateId);

    expect(response.status).toBe(202);
    const body = StartReviewResponse.parse(await response.json());
    expect(body.review.id).not.toBe(failed.id);
    await waitUntilEnded(body.review.id);
  });

  test("signed out, unverified and unknown debates are refused", async () => {
    const verified = await newFan(baseUrl, true);
    const unverified = await newFan(baseUrl, false);
    const debateId = await insertDebate(verified.userId);

    const anonymous = await new Fan(baseUrl).call(`/api/debates/${debateId}/reviews`, { body: {} });
    expect(anonymous.status).toBe(401);

    const notConfirmed = await startReview(unverified.fan, debateId);
    expect(notConfirmed.status).toBe(403);
    expect((await errorOf(notConfirmed)).code).toBe("EMAIL_NOT_VERIFIED");

    const unknown = await startReview(verified.fan, crypto.randomUUID());
    expect(unknown.status).toBe(404);

    const malformed = await startReview(verified.fan, "not-a-uuid");
    expect(malformed.status).toBe(404);
  });

  test("a fan past 3 reviews in 24h gets 429 with when a slot frees up; failed ones don't count", async () => {
    const { fan, userId } = await newFan(baseUrl, true);

    // 3 counted reviews on other debates, oldest 2 hours ago, plus a failed one
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let index = 0; index < 3; index++) {
      const otherDebate = await insertDebate(userId);
      let createdAt = new Date();
      if (index === 0) {
        createdAt = twoHoursAgo;
      }
      await prisma.review.create({
        data: { debateId: otherDebate, status: "COMPLETE", requestedById: userId, createdAt: createdAt },
      });
    }
    const failedDebate = await insertDebate(userId);
    await prisma.review.create({ data: { debateId: failedDebate, status: "FAILED", requestedById: userId } });

    const debateId = await insertDebate(userId);
    const response = await startReview(fan, debateId);

    expect(response.status).toBe(429);
    const error = await errorOf(response);
    expect(error.code).toBe("REVIEW_LIMIT_REACHED");
    const expectedRetryAt = new Date(twoHoursAgo.getTime() + 24 * 60 * 60 * 1000);
    expect(error.retryAt).toBe(expectedRetryAt.toISOString());
    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(21 * 60 * 60);
  });

  test("a review started 25 hours ago no longer counts toward the cap", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    await seedReview(userId, 25);
    await seedReview(userId, 2);
    await seedReview(userId, 1);
    const debateId = await insertDebate(userId);

    const response = await startReview(fan, debateId);

    expect(response.status).toBe(202);
    await waitUntilEnded(StartReviewResponse.parse(await response.json()).review.id);
  });

  test("a review started 23 hours ago still counts, and sets when the next slot frees up", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const oldest = await seedReview(userId, 23);
    await seedReview(userId, 2);
    await seedReview(userId, 1);
    const debateId = await insertDebate(userId);

    const response = await startReview(fan, debateId);

    expect(response.status).toBe(429);
    const error = await errorOf(response);
    expect(error.retryAt).toBe(new Date(oldest.createdAt.getTime() + 24 * HOUR_MS).toISOString());
    // about an hour left, never zero or negative
    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(50 * 60);
    expect(retryAfter).toBeLessThanOrEqual(60 * 60);
  });

  test("a review that fails stops holding a slot, so retryAt moves", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const oldest = await seedReview(userId, 10);
    const secondOldest = await seedReview(userId, 5);
    await seedReview(userId, 2);
    await seedReview(userId, 1);
    const debateId = await insertDebate(userId);

    // 4 counted reviews and a limit of 3: two have to age out before the count drops
    // below 3, so the second oldest decides when a slot frees up
    const before = await errorOf(await startReview(fan, debateId));
    expect(before.retryAt).toBe(new Date(secondOldest.createdAt.getTime() + 24 * HOUR_MS).toISOString());

    // once it fails it no longer counts: 3 are left, and now the oldest decides
    await prisma.review.update({ where: { id: secondOldest.reviewId }, data: { status: "FAILED" } });
    const after = await errorOf(await startReview(fan, debateId));

    expect(after.code).toBe("REVIEW_LIMIT_REACHED");
    expect(after.retryAt).toBe(new Date(oldest.createdAt.getTime() + 24 * HOUR_MS).toISOString());
  });

  test("a fan at the cap still gets back a review that already exists", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    await seedReview(userId, 3);
    await seedReview(userId, 2);
    await seedReview(userId, 1);
    // someone else already reviewed this debate
    const debateId = await insertDebate(userId);
    const existing = await prisma.review.create({ data: { debateId: debateId, status: "COMPLETE" } });

    const response = await startReview(fan, debateId);

    expect(response.status).toBe(200);
    const body = StartReviewResponse.parse(await response.json());
    expect(body.review.id).toBe(existing.id);
  });

  test("the requester is always the signed in fan, whatever the body says", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const other = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);

    const response = await fan.call(`/api/debates/${debateId}/reviews`, {
      body: { requestedById: other.userId, requestedBy: other.userId },
    });

    expect(response.status).toBe(202);
    const reviewId = StartReviewResponse.parse(await response.json()).review.id;
    const row = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.requestedById).toBe(userId);
    await waitUntilEnded(reviewId);
  });

  test("the moderator reviews the debate's title, a blank line, then its thesis", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);

    const reviewId = await startAndReadId(fan, debateId);
    await waitUntilEnded(reviewId);

    expect(control.moderatorInputs).toContain(
      "Bellingham false 9\n\nBellingham is more effective as a false 9 than as an 8.",
    );
  });
});

describe.skipIf(!hasTestDatabase)("GET /api/reviews/:id", () => {
  test("returns the verdict with claims, entities, cited labels and the evidence ledger", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    const reviewId = await startAndReadId(fan, debateId);
    await waitUntilEnded(reviewId);

    // read it signed out: verdicts are public
    const response = await fetch(`${baseUrl}/api/reviews/${reviewId}`);

    expect(response.status).toBe(200);
    const json = await response.json();
    const body = ReviewResponse.parse(json);
    expect(body.review.status).toBe("COMPLETE");
    expect(body.review.decision).toBe("CONFIRMED");
    expect(body.review.credibilityScore).toBe(100);
    expect(body.review.summary).toBe("2 claims: 1 stands, 1 not testable");
    expect(body.review.failure).toBeNull();

    const testable = body.review.claims[0];
    expect(testable?.entities).toEqual({ player: "Bellingham", positionA: "false 9", positionB: "8" });
    expect(testable?.citedLabels).toEqual(["E1", "E2"]);
    expect(body.review.claims[1]?.verdict).toBe("UNTESTABLE");

    expect(body.review.evidence).toHaveLength(2);
    expect(body.review.evidence[0]?.label).toBe("E1");
    expect(body.review.evidence[0]?.claimOrder).toBe(1);
    expect(body.review.evidence[0]?.status).toBe("ok");

    // who asked for it stays internal
    expect(JSON.stringify(json)).not.toContain(userId);
  });

  test("a failed review shows a safe category, never the raw error", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.searchFails = true;

    const reviewId = await startAndReadId(fan, debateId);
    const status = await waitUntilEnded(reviewId);
    expect(status).toBe("FAILED");

    const response = await fetch(`${baseUrl}/api/reviews/${reviewId}`);
    const json = await response.json();
    const body = ReviewResponse.parse(json);
    expect(body.review.failure).toEqual({ category: "ai_service", message: "The AI service had a problem." });
    expect(JSON.stringify(json)).not.toContain("quota");
  });

  test("a running review shows its status with no claims or evidence yet", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.moderatorGate = makeGate();
    const reviewId = await startAndReadId(fan, debateId);

    const response = await fetch(`${baseUrl}/api/reviews/${reviewId}`);

    const body = ReviewResponse.parse(await response.json());
    expect(["QUEUED", "RUNNING"]).toContain(body.review.status);
    expect(body.review.claims).toEqual([]);
    expect(body.review.evidence).toEqual([]);
    expect(body.review.decision).toBeNull();
    expect(body.review.completedAt).toBeNull();

    control.moderatorGate.open();
    await waitUntilEnded(reviewId);
  });

  test("a search that finds nothing shows no_sources, and the review still completes", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.searchFindsNothing = true;

    const reviewId = await startAndReadId(fan, debateId);
    const status = await waitUntilEnded(reviewId);

    // finding nothing isn't an outage, so the review ends normally
    expect(status).toBe("COMPLETE");
    const body = ReviewResponse.parse(await (await fetch(`${baseUrl}/api/reviews/${reviewId}`)).json());
    expect(body.review.evidence.length).toBeGreaterThan(0);
    for (const evidence of body.review.evidence) {
      expect(evidence.status).toBe("no_sources");
      expect(evidence.sourceUrl).toBeNull();
    }
    expect(body.review.claims[0]?.verdict).toBe("INSUFFICIENT_DATA");
  });

  test("a debate with only untestable claims ends COMPLETE and INCONCLUSIVE, with no score", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    await prisma.debate.update({ where: { id: debateId }, data: { credibilityScore: 55 } });
    control.moderatorAnswer = untestableOnlyOutput;

    const reviewId = await startAndReadId(fan, debateId);
    const status = await waitUntilEnded(reviewId);

    // no search ran, so this must not be mistaken for "every search failed"
    expect(status).toBe("COMPLETE");
    const body = ReviewResponse.parse(await (await fetch(`${baseUrl}/api/reviews/${reviewId}`)).json());
    expect(body.review.decision).toBe("INCONCLUSIVE");
    expect(body.review.credibilityScore).toBeNull();
    expect(body.review.summary).toBe("1 claim: 1 not testable");
    expect(body.review.claims[0]?.verdict).toBe("UNTESTABLE");
    expect(body.review.evidence).toEqual([]);

    // a review with no score leaves the debate's last score alone
    const debate = await prisma.debate.findUniqueOrThrow({ where: { id: debateId } });
    expect(debate.credibilityScore).toBe(55);
  });

  test("a complete review copies its score onto the debate", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);

    const reviewId = await startAndReadId(fan, debateId);
    await waitUntilEnded(reviewId);

    const debate = await prisma.debate.findUniqueOrThrow({ where: { id: debateId } });
    expect(debate.credibilityScore).toBe(100);
  });

  test("unknown and malformed ids are 404", async () => {
    const unknown = await fetch(`${baseUrl}/api/reviews/${crypto.randomUUID()}`);
    expect(unknown.status).toBe(404);
    const malformed = await fetch(`${baseUrl}/api/reviews/nope`);
    expect(malformed.status).toBe(404);
  });
});

describe.skipIf(!hasTestDatabase)("GET /api/reviews/:id/events", () => {
  test("streams claims_extracted, then review_completed, then closes", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.moderatorGate = makeGate();

    const reviewId = await startAndReadId(fan, debateId);
    const stream = await openStream(reviewId);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    control.moderatorGate.open();
    const messages = await readSse(stream);

    expect(eventNames(messages)).toEqual(["claims_extracted", "review_completed"]);
    expect(messages[0]?.id).not.toBeNull();
    expect(messages[0]?.data.claims).toHaveLength(2);
    expect(messages[1]?.data.decision).toBe("CONFIRMED");
    expect(messages[1]?.data.credibilityScore).toBe(100);

    // progress events are gone once the review ended
    const leftover = await prisma.reviewEvent.count({ where: { reviewId: reviewId } });
    expect(leftover).toBe(0);
  });

  test("a reconnect with Last-Event-ID doesn't repeat events and still gets the end", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.factCheckerGate = makeGate();

    const reviewId = await startAndReadId(fan, debateId);

    // first connection: take the claims event, then drop
    const first = await openStream(reviewId);
    const firstMessages = await readSse(first, 1);
    expect(firstMessages[0]?.event).toBe("claims_extracted");
    const lastId = firstMessages[0]!.id;

    // reconnect where we left off, then let the fact checker finish
    const second = await openStream(reviewId, lastId);
    control.factCheckerGate.open();
    const secondMessages = await readSse(second);

    expect(eventNames(secondMessages)).toEqual(["review_completed"]);
  });

  test("a finished review sends one final event rebuilt from the db, then closes", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    const reviewId = await startAndReadId(fan, debateId);
    await waitUntilEnded(reviewId);

    const messages = await readSse(await openStream(reviewId));

    expect(eventNames(messages)).toEqual(["review_completed"]);
    expect(messages[0]?.data.summary).toBe("2 claims: 1 stands, 1 not testable");
  });

  test("an outage ends the stream with review_failed and doesn't spend the fan's slot", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.searchFails = true;
    control.moderatorGate = makeGate();

    const reviewId = await startAndReadId(fan, debateId);
    const stream = await openStream(reviewId);
    control.moderatorGate.open();
    const messages = await readSse(stream);

    expect(eventNames(messages)).toEqual(["claims_extracted", "review_failed"]);
    expect(messages[1]?.data.failure.category).toBe("ai_service");

    const counted = await prisma.review.count({ where: { requestedById: userId, status: { not: "FAILED" } } });
    expect(counted).toBe(0);
  });

  test("deleting the debate mid review ends the stream with review_failed", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.factCheckerGate = makeGate();

    const reviewId = await startAndReadId(fan, debateId);
    const stream = await openStream(reviewId);
    const firstMessages = await readSse(stream, 1);
    expect(firstMessages[0]?.event).toBe("claims_extracted");

    // a second viewer stays connected while the debate goes away
    const watcher = await openStream(reviewId, firstMessages[0]!.id);
    await prisma.debate.delete({ where: { id: debateId } });
    control.factCheckerGate.open();
    const messages = await readSse(watcher);

    expect(eventNames(messages)).toEqual(["review_failed"]);
    expect(messages[0]?.data.failure.category).toBe("internal");
  });

  test("the stream sends the headers that stop caches and proxies from holding events back", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.moderatorGate = makeGate();
    const reviewId = await startAndReadId(fan, debateId);

    const stream = await openStream(reviewId);

    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("cache-control")).toBe("no-cache");
    expect(stream.headers.get("x-accel-buffering")).toBe("no");

    control.moderatorGate.open();
    await readSse(stream);
  });

  test("a Last-Event-ID that isn't a number replays everything saved", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.factCheckerGate = makeGate();
    const reviewId = await startAndReadId(fan, debateId);
    const first = await readSse(await openStream(reviewId), 1);
    expect(first[0]?.event).toBe("claims_extracted");

    const second = await openStream(reviewId, "not-a-number");
    control.factCheckerGate.open();
    const messages = await readSse(second);

    expect(eventNames(messages)).toEqual(["claims_extracted", "review_completed"]);
  });

  test("a failed review that already ended sends one review_failed rebuilt from the db", async () => {
    const { userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    const failed = await prisma.review.create({
      data: { debateId: debateId, status: "FAILED", failureReason: "fact_checker: Gemini error 500: boom" },
    });

    const messages = await readSse(await openStream(failed.id));

    expect(eventNames(messages)).toEqual(["review_failed"]);
    expect(messages[0]?.data.failure).toEqual({ category: "ai_service", message: "The AI service had a problem." });
    expect(JSON.stringify(messages)).not.toContain("boom");
  });

  test("a malformed review id is a plain 404, not a stream", async () => {
    const response = await openStream("not-a-uuid");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("an unknown review is a plain 404, not a stream", async () => {
    const response = await openStream(crypto.randomUUID());
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe.skipIf(!hasTestDatabase)("timeouts and restarts", () => {
  test("a review still running at the time limit is failed, and its late result is dropped", async () => {
    const stuck = makeGate();
    const stuckAgents: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        return reply(factCheckerOutput);
      }
      await stuck.promise;
      return reply(moderatorOutput);
    };
    const quick = await startTestServer({
      runAgentFn: stuckAgents,
      searchWebFn: fakeSearch,
      timeoutMs: 500,
      retryDelayMs: 0,
    });

    try {
      const { fan, userId } = await newFan(quick.baseUrl, true);
      const debateId = await insertDebate(userId);
      const response = await fan.call(`/api/debates/${debateId}/reviews`, { body: {} });
      const reviewId = StartReviewResponse.parse(await response.json()).review.id;

      const status = await waitUntilEnded(reviewId);
      expect(status).toBe("FAILED");

      // let the stuck agent finish; its result must not overwrite the timeout
      stuck.open();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId }, include: { claims: true } });
      expect(review.status).toBe("FAILED");
      expect(review.failureReason).toStartWith("timeout:");
      expect(review.claims).toHaveLength(0);

      // the moderator call that was running is still recorded. after it, a timed out
      // review holds no daily budget, so no search or fact checker call may start
      let moderatorCalls = 0;
      for (let tries = 0; tries < 50 && moderatorCalls === 0; tries++) {
        moderatorCalls = await prisma.aiCall.count({ where: { reviewId: reviewId, step: "MODERATOR" } });
        if (moderatorCalls === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      expect(moderatorCalls).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const laterCalls = await prisma.aiCall.count({ where: { reviewId: reviewId, step: { not: "MODERATOR" } } });
      expect(laterCalls).toBe(0);
    } finally {
      quick.server.close();
    }
  });

  test("on start, reviews left running by the last process are failed and their events removed", async () => {
    const { userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    const running = await prisma.review.create({ data: { debateId: debateId, status: "RUNNING" } });
    await prisma.reviewEvent.create({ data: { reviewId: running.id, seq: 1, type: "claims_extracted", payload: {} } });

    await recoverInterruptedReviews();

    const review = await prisma.review.findUniqueOrThrow({ where: { id: running.id } });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toStartWith("restart:");
    const events = await prisma.reviewEvent.count({ where: { reviewId: running.id } });
    expect(events).toBe(0);

    // a stream opened afterwards gets the restart failure
    const messages = await readSse(await openStream(running.id));
    expect(eventNames(messages)).toEqual(["review_failed"]);
    expect(messages[0]?.data.failure.category).toBe("restart");
  });
});

describe.skipIf(!hasTestDatabase)("runner crashes", () => {
  test("a crash outside the pipeline fails the review instead of leaving it QUEUED", async () => {
    const { userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    const queued = await prisma.review.create({ data: { debateId: debateId, status: "QUEUED" } });

    // a debate id that isn't a uuid makes loading the debate text throw, before the pipeline
    const runner = createReviewRunner({ runAgentFn: fakeAgents, searchWebFn: fakeSearch, retryDelayMs: 0 });
    const received: StreamMessage[] = [];
    const finalEvent = new Promise<void>((resolve) => {
      runner.subscribe(queued.id, (message) => {
        received.push(message);
        resolve();
      });
    });

    runner.start(queued.id, "not-a-uuid");
    await finalEvent;

    const review = await prisma.review.findUniqueOrThrow({ where: { id: queued.id } });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toBe("internal: runner crashed");
    expect(review.completedAt).not.toBeNull();

    // open streams get the final event, with the safe category only
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe("review_failed");
    expect(JSON.stringify(received[0])).toContain("internal");
    expect(JSON.stringify(received[0])).not.toContain("runner crashed");
  });
});

describe.skipIf(!hasTestDatabase)("ai call recording", () => {
  test("a review started from the api records one row per gemini attempt", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);

    const reviewId = await startAndReadId(fan, debateId);
    await waitUntilEnded(reviewId);

    const calls = await prisma.aiCall.findMany({ where: { reviewId: reviewId }, orderBy: { id: "asc" } });
    const steps: string[] = [];
    for (const call of calls) {
      steps.push(call.step);
    }
    expect(steps).toEqual(["MODERATOR", "SEARCH", "FACT_CHECKER"]);
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.aiCallCount).toBe(3);
  });

  test("a search failing with 429 is tried twice and both attempts are recorded", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);
    control.searchFails = true;

    const reviewId = await startAndReadId(fan, debateId);
    await waitUntilEnded(reviewId);

    const searches = await prisma.aiCall.findMany({
      where: { reviewId: reviewId, step: "SEARCH" },
      orderBy: { id: "asc" },
    });
    expect(searches).toHaveLength(2);
    expect(searches[0]?.status).toBe("ERROR");
    expect(searches[1]?.status).toBe("ERROR");
    expect(searches[1]?.attempt).toBe(2);
    expect(searches[0]?.error).toContain("429");
  });
});

// the daily gemini budget. the whole test run shares one database, so each test
// starts its own server with a limit measured from where the budget is right now

// a daily limit with room for exactly `reviews` more reviews (16 calls each)
async function limitWithRoomFor(reviews: number): Promise<number> {
  const now = await getBudgetStatus(1_000_000);
  return now.used + now.reserved + 16 * reviews;
}

// a server with the usual fakes and its own daily limit
function startBudgetServer(aiDailyCallLimit: number) {
  return startTestServer(
    { runAgentFn: fakeAgents, searchWebFn: fakeSearch, retryDelayMs: 0 },
    { AI_DAILY_CALL_LIMIT: String(aiDailyCallLimit) },
  );
}

// "00:00:00" when the time is midnight in pacific time
function pacificClock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);
}

async function makeAdmin(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
}

describe.skipIf(!hasTestDatabase)("daily gemini budget", () => {
  test("with room for one more review, the next start gets 503 until midnight pacific", async () => {
    const quick = await startBudgetServer(await limitWithRoomFor(1));
    try {
      const { fan, userId } = await newFan(quick.baseUrl, true);
      const firstDebate = await insertDebate(userId);
      const secondDebate = await insertDebate(userId);
      control.moderatorGate = makeGate();

      const first = await startReview(fan, firstDebate);
      expect(first.status).toBe(202);
      const firstId = StartReviewResponse.parse(await first.json()).review.id;

      const second = await startReview(fan, secondDebate);

      expect(second.status).toBe(503);
      const error = await errorOf(second);
      expect(error.code).toBe("DAILY_BUDGET_REACHED");
      expect(error.message).toStartWith("VAR is resting for today. Reviews open again at ");
      const retryAt = new Date(error.retryAt!);
      expect(pacificClock(retryAt)).toBe("00:00:00");
      const status = await getBudgetStatus(1_000_000);
      expect(retryAt.toISOString()).toBe(status.resetsAt.toISOString());

      // Retry-After is the seconds left until then, rounded up
      const expectedSeconds = Math.ceil((retryAt.getTime() - Date.now()) / 1000);
      const retryAfter = Number(second.headers.get("Retry-After"));
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(Math.abs(retryAfter - expectedSeconds)).toBeLessThanOrEqual(5);

      // no review row for the refused start
      const count = await prisma.review.count({ where: { debateId: secondDebate } });
      expect(count).toBe(0);

      control.moderatorGate.open();
      await waitUntilEnded(firstId);
    } finally {
      quick.server.close();
    }
  });

  test("a finished review gives back the calls it didn't use", async () => {
    // room for one review plus the 3 calls the fake review really makes
    const quick = await startBudgetServer((await limitWithRoomFor(1)) + 3);
    try {
      const { fan, userId } = await newFan(quick.baseUrl, true);
      const firstDebate = await insertDebate(userId);
      const secondDebate = await insertDebate(userId);
      control.moderatorGate = makeGate();

      const firstId = await startAndReadId(fan, firstDebate);
      // while it runs it holds all 16 calls
      const whileRunning = await startReview(fan, secondDebate);
      expect(whileRunning.status).toBe(503);

      control.moderatorGate.open();
      await waitUntilEnded(firstId);

      const afterwards = await startReview(fan, secondDebate);
      expect(afterwards.status).toBe(202);
      await waitUntilEnded(StartReviewResponse.parse(await afterwards.json()).review.id);
    } finally {
      quick.server.close();
    }
  });

  test("two starts on different debates at the same moment with room for one: one 202, one 503", async () => {
    const quick = await startBudgetServer(await limitWithRoomFor(1));
    try {
      const first = await newFan(quick.baseUrl, true);
      const second = await newFan(quick.baseUrl, true);
      const debateA = await insertDebate(first.userId);
      const debateB = await insertDebate(second.userId);
      control.moderatorGate = makeGate();

      const responses = await Promise.all([startReview(first.fan, debateA), startReview(second.fan, debateB)]);

      const statuses = [responses[0].status, responses[1].status].sort();
      expect(statuses).toEqual([202, 503]);
      const count = await prisma.review.count({ where: { debateId: { in: [debateA, debateB] } } });
      expect(count).toBe(1);

      control.moderatorGate.open();
      for (const response of responses) {
        if (response.status === 202) {
          await waitUntilEnded(StartReviewResponse.parse(await response.json()).review.id);
        }
      }
    } finally {
      quick.server.close();
    }
  });

  test("a debate's existing review is still returned with 200 when the budget is out", async () => {
    const quick = await startBudgetServer((await limitWithRoomFor(1)) - 1);
    try {
      const { fan, userId } = await newFan(quick.baseUrl, true);
      const debateId = await insertDebate(userId);
      const existing = await prisma.review.create({ data: { debateId: debateId, status: "COMPLETE" } });

      const response = await startReview(fan, debateId);

      expect(response.status).toBe(200);
      expect(StartReviewResponse.parse(await response.json()).review.id).toBe(existing.id);
    } finally {
      quick.server.close();
    }
  });

  test("an admin past 3 reviews in 24h can still start one", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    await makeAdmin(userId);
    await seedReview(userId, 3);
    await seedReview(userId, 2);
    await seedReview(userId, 1);
    const debateId = await insertDebate(userId);

    const response = await startReview(fan, debateId);

    expect(response.status).toBe(202);
    await waitUntilEnded(StartReviewResponse.parse(await response.json()).review.id);
  });

  test("an admin is refused like everyone else when the budget is out", async () => {
    const quick = await startBudgetServer((await limitWithRoomFor(1)) - 1);
    try {
      const { fan, userId } = await newFan(quick.baseUrl, true);
      await makeAdmin(userId);
      const debateId = await insertDebate(userId);

      const response = await startReview(fan, debateId);

      expect(response.status).toBe(503);
      expect((await errorOf(response)).code).toBe("DAILY_BUDGET_REACHED");
    } finally {
      quick.server.close();
    }
  });

  test("the fan cap reads its limit from REVIEW_DAILY_LIMIT", async () => {
    const quick = await startTestServer(
      { runAgentFn: fakeAgents, searchWebFn: fakeSearch, retryDelayMs: 0 },
      { REVIEW_DAILY_LIMIT: "5" },
    );
    try {
      const { fan, userId } = await newFan(quick.baseUrl, true);
      await seedReview(userId, 3);
      await seedReview(userId, 2);
      await seedReview(userId, 1);
      const debateId = await insertDebate(userId);

      // 3 reviews in 24h is fine when the limit is 5
      const response = await startReview(fan, debateId);

      expect(response.status).toBe(202);
      await waitUntilEnded(StartReviewResponse.parse(await response.json()).review.id);
    } finally {
      quick.server.close();
    }
  });
});

describe.skipIf(!hasTestDatabase)("GET /api/reviews/availability", () => {
  test("open while a review still fits, with when the budget resets and nothing else", async () => {
    // signed out: availability is public
    const response = await fetch(`${baseUrl}/api/reviews/availability`);

    expect(response.status).toBe(200);
    const json = (await response.json()) as object;
    // never the call counts, only these two fields
    expect(Object.keys(json).sort()).toEqual(["open", "resetsAt"]);
    const body = AvailabilityResponse.parse(json);
    expect(body.open).toBe(true);
    expect(pacificClock(new Date(body.resetsAt))).toBe("00:00:00");
  });

  test("closed when one more review wouldn't fit", async () => {
    const limit = (await limitWithRoomFor(1)) - 1;
    const quick = await startBudgetServer(limit);
    try {
      const response = await fetch(`${quick.baseUrl}/api/reviews/availability`);

      expect(response.status).toBe(200);
      const json = (await response.json()) as object;
      expect(Object.keys(json).sort()).toEqual(["open", "resetsAt"]);
      const body = AvailabilityResponse.parse(json);
      expect(body.open).toBe(false);
      const status = await getBudgetStatus(limit);
      expect(body.resetsAt).toBe(status.resetsAt.toISOString());
    } finally {
      quick.server.close();
    }
  });
});

describe.skipIf(!hasTestDatabase)("when the budget can't be checked", () => {
  // hides the ai_calls table for a moment, so the budget query really fails
  // like a database outage would, then puts it back
  async function withAiCallsHidden(run: () => Promise<void>) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ai_calls" RENAME TO "ai_calls_hidden"`);
    try {
      await run();
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ai_calls_hidden" RENAME TO "ai_calls"`);
    }
  }

  test("a start answers 503 SERVICE_UNAVAILABLE and creates nothing", async () => {
    const { fan, userId } = await newFan(baseUrl, true);
    const debateId = await insertDebate(userId);

    let status = 0;
    let code = "";
    await withAiCallsHidden(async () => {
      const response = await startReview(fan, debateId);
      status = response.status;
      code = (await errorOf(response)).code;
    });

    expect(status).toBe(503);
    expect(code).toBe("SERVICE_UNAVAILABLE");
    const count = await prisma.review.count({ where: { debateId: debateId } });
    expect(count).toBe(0);
  });

  test("availability answers 503 SERVICE_UNAVAILABLE too", async () => {
    let status = 0;
    let code = "";
    await withAiCallsHidden(async () => {
      const response = await fetch(`${baseUrl}/api/reviews/availability`);
      status = response.status;
      code = (await errorOf(response)).code;
    });

    expect(status).toBe(503);
    expect(code).toBe("SERVICE_UNAVAILABLE");
  });
});
