import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "./client.ts";
import { createDebate } from "./debates.ts";
import { getBudgetStatus, startReviewLocked } from "./budget.ts";
import type { StartReviewInput } from "./budget.ts";

// integration tests for the daily gemini budget and the locked review start, on the
// neon test branch. only run when the root test preload pointed DATABASE_URL at it.
// the whole run shares one database, so every test measures from where the budget
// is right now (a baseline) instead of assuming it starts empty
const onTestDatabase =
  Boolean(process.env.DATABASE_URL_TEST) &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

// big enough to never run out, for reading the numbers
const HUGE_LIMIT = 1_000_000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

let userId: string;

// live reviews this file leaves behind. they're failed at the end, so their
// reserve doesn't linger into the next test file
const liveReviewIds: string[] = [];

beforeAll(async () => {
  if (!onTestDatabase) return;
  const user = await prisma.user.create({
    data: {
      id: `budget-test-${crypto.randomUUID()}`,
      email: `budget-test-${crypto.randomUUID()}@varroom.test`,
      name: "Budget Test",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  if (!onTestDatabase) return;
  await prisma.review.updateMany({
    where: { id: { in: liveReviewIds }, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", failureReason: "internal: test cleanup" },
  });
});

// helpers

async function newDebate(): Promise<string> {
  return createDebate({
    authorId: userId,
    title: "Rice as a 6",
    thesis: "Declan Rice is better as a 6 than as an 8",
    categories: ["OTHER"],
    tagIds: [],
  });
}

// a review saved straight into the table, e.g. one that started a while ago
async function seedReview(options: {
  status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
  minutesAgo?: number;
  requestedById?: string | null;
}): Promise<string> {
  const debateId = await newDebate();
  const minutesAgo = options.minutesAgo ?? 0;
  const review = await prisma.review.create({
    data: {
      debateId: debateId,
      status: options.status,
      requestedById: options.requestedById ?? null,
      createdAt: new Date(Date.now() - minutesAgo * MINUTE_MS),
    },
  });
  if (options.status === "QUEUED" || options.status === "RUNNING") {
    liveReviewIds.push(review.id);
  }
  return review.id;
}

// saves `count` finished gemini attempts, for a review or for none
async function seedCalls(count: number, reviewId: string | null, startedAt: Date = new Date()): Promise<void> {
  for (let index = 0; index < count; index++) {
    await prisma.aiCall.create({
      data: {
        reviewId: reviewId,
        step: "SEARCH",
        attempt: 1,
        claimOrder: 1,
        model: "test-model",
        status: "OK",
        durationMs: 100,
        startedAt: startedAt,
      },
    });
  }
}

// a start on a fresh debate by our test fan, with whatever a test wants to change
async function startInput(overrides: Partial<StartReviewInput> = {}): Promise<StartReviewInput> {
  return {
    debateId: await newDebate(),
    model: "test-model",
    requestedById: userId,
    fanDailyLimit: null,
    aiDailyCallLimit: HUGE_LIMIT,
    ...overrides,
  };
}

// a daily limit with room for exactly `reviews` more reviews, from where the budget is now
async function limitWithRoomFor(reviews: number): Promise<number> {
  const now = await getBudgetStatus(HUGE_LIMIT);
  return now.used + now.reserved + 16 * reviews;
}

// "00:00" when the time is midnight in pacific time
function pacificClock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);
}

describe.skipIf(!onTestDatabase)("getBudgetStatus", () => {
  test("resets at the next midnight pacific time", async () => {
    const status = await getBudgetStatus(HUGE_LIMIT);

    expect(pacificClock(status.resetsAt)).toBe("00:00:00");
    const msLeft = status.resetsAt.getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(0);
    // at most a day away (25 hours on the night the clocks go back)
    expect(msLeft).toBeLessThanOrEqual(25 * HOUR_MS);
  });

  test("counts every call made today, even ones with no review", async () => {
    const before = await getBudgetStatus(HUGE_LIMIT);

    await seedCalls(3, null);

    const after = await getBudgetStatus(HUGE_LIMIT);
    expect(after.used).toBe(before.used + 3);
  });

  test("calls from before the last midnight pacific don't count", async () => {
    const before = await getBudgetStatus(HUGE_LIMIT);
    const dayStart = new Date(before.resetsAt.getTime() - 24 * HOUR_MS);

    // a day and a half ago is always before today's midnight
    await seedCalls(2, null, new Date(Date.now() - 36 * HOUR_MS));
    // one second after the last midnight still counts. it can't be in the future,
    // so only seed it when the day is already more than a second old
    const justAfterMidnight = new Date(dayStart.getTime() + 1000);
    let expectedNew = 0;
    if (justAfterMidnight.getTime() < Date.now()) {
      await seedCalls(1, null, justAfterMidnight);
      expectedNew = 1;
    }

    const after = await getBudgetStatus(HUGE_LIMIT);
    expect(after.used).toBe(before.used + expectedNew);
  });

  test("a running review holds 16 calls minus the calls it already made", async () => {
    const before = await getBudgetStatus(HUGE_LIMIT);

    const reviewId = await seedReview({ status: "RUNNING" });
    await seedCalls(3, reviewId);

    const after = await getBudgetStatus(HUGE_LIMIT);
    expect(after.reserved).toBe(before.reserved + 13);
    expect(after.used).toBe(before.used + 3);
  });

  test("a queued review that hasn't made a call yet holds all 16", async () => {
    const before = await getBudgetStatus(HUGE_LIMIT);

    await seedReview({ status: "QUEUED" });

    const after = await getBudgetStatus(HUGE_LIMIT);
    expect(after.reserved).toBe(before.reserved + 16);
  });

  test("a review's reserve never goes below zero", async () => {
    const before = await getBudgetStatus(HUGE_LIMIT);

    // more calls than the reserve, which can't happen, but must not hand calls back
    const reviewId = await seedReview({ status: "RUNNING" });
    await seedCalls(18, reviewId);

    const after = await getBudgetStatus(HUGE_LIMIT);
    expect(after.reserved).toBe(before.reserved);
  });

  test("finished and failed reviews hold no reserve", async () => {
    const before = await getBudgetStatus(HUGE_LIMIT);

    await seedReview({ status: "COMPLETE" });
    await seedReview({ status: "FAILED" });

    const after = await getBudgetStatus(HUGE_LIMIT);
    expect(after.reserved).toBe(before.reserved);
  });

  test("a queued or running review older than 4 minutes is stuck and holds no reserve", async () => {
    const before = await getBudgetStatus(HUGE_LIMIT);

    await seedReview({ status: "QUEUED", minutesAgo: 5 });
    await seedReview({ status: "RUNNING", minutesAgo: 5 });
    // just inside the window still counts
    await seedReview({ status: "RUNNING", minutesAgo: 3 });

    const after = await getBudgetStatus(HUGE_LIMIT);
    expect(after.reserved).toBe(before.reserved + 16);
  });

  test("open only while one more review's 16 calls still fit", async () => {
    const now = await getBudgetStatus(HUGE_LIMIT);
    const exactFit = now.used + now.reserved + 16;

    const fits = await getBudgetStatus(exactFit);
    expect(fits.open).toBe(true);
    expect(fits.left).toBe(16);
    expect(fits.limit).toBe(exactFit);

    const tooSmall = await getBudgetStatus(exactFit - 1);
    expect(tooSmall.open).toBe(false);
    expect(tooSmall.left).toBe(15);
  });

  test("calls left never goes below zero", async () => {
    await seedCalls(1, null);

    const status = await getBudgetStatus(1);

    expect(status.left).toBe(0);
    expect(status.open).toBe(false);
  });
});

describe.skipIf(!onTestDatabase)("startReviewLocked", () => {
  test("creates a QUEUED review for the requester when there's room", async () => {
    const input = await startInput();

    const result = await startReviewLocked(input);

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    liveReviewIds.push(result.review.id);
    expect(result.review.status).toBe("QUEUED");
    expect(result.review.debateId).toBe(input.debateId);
    const row = await prisma.review.findUniqueOrThrow({ where: { id: result.review.id } });
    expect(row.requestedById).toBe(userId);
    expect(row.model).toBe("test-model");
  });

  test("a new review holds its reserve straight away", async () => {
    const before = await getBudgetStatus(HUGE_LIMIT);

    const result = await startReviewLocked(await startInput());
    if (result.outcome === "created") liveReviewIds.push(result.review.id);

    const after = await getBudgetStatus(HUGE_LIMIT);
    expect(after.reserved).toBe(before.reserved + 16);
  });

  test("returns the debate's existing review instead of making a second one", async () => {
    const input = await startInput();
    const first = await startReviewLocked(input);
    if (first.outcome === "created") liveReviewIds.push(first.review.id);

    const second = await startReviewLocked(input);

    expect(second.outcome).toBe("exists");
    if (first.outcome !== "created" || second.outcome !== "exists") return;
    expect(second.review.id).toBe(first.review.id);
    const count = await prisma.review.count({ where: { debateId: input.debateId } });
    expect(count).toBe(1);
  });

  test("two starts on the same debate at the same moment end up with one review", async () => {
    const input = await startInput();

    const results = await Promise.all([startReviewLocked(input), startReviewLocked(input)]);

    const outcomes = [results[0].outcome, results[1].outcome].sort();
    expect(outcomes).toEqual(["created", "exists"]);
    const count = await prisma.review.count({ where: { debateId: input.debateId } });
    expect(count).toBe(1);
    for (const result of results) {
      if (result.outcome === "created") liveReviewIds.push(result.review.id);
    }
  });

  test("the budget refuses a review whose 16 calls don't fit, and creates nothing", async () => {
    const limit = (await limitWithRoomFor(1)) - 1;
    const input = await startInput({ aiDailyCallLimit: limit });

    const result = await startReviewLocked(input);

    expect(result.outcome).toBe("budget");
    if (result.outcome !== "budget") return;
    const status = await getBudgetStatus(limit);
    expect(result.resetsAt.toISOString()).toBe(status.resetsAt.toISOString());
    expect(result.budget.limit).toBe(limit);
    const count = await prisma.review.count({ where: { debateId: input.debateId } });
    expect(count).toBe(0);
  });

  test("with room for exactly one, the first start fits and the next is refused", async () => {
    const limit = await limitWithRoomFor(1);

    const first = await startReviewLocked(await startInput({ aiDailyCallLimit: limit }));
    const second = await startReviewLocked(await startInput({ aiDailyCallLimit: limit }));

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("budget");
    if (first.outcome === "created") liveReviewIds.push(first.review.id);
  });

  test("a finished review gives back the calls it didn't use", async () => {
    // room for one review plus the 3 calls it will really make
    const limit = (await limitWithRoomFor(1)) + 3;
    const first = await startReviewLocked(await startInput({ aiDailyCallLimit: limit }));
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") return;

    // while it runs it holds all 16, so nothing else fits
    const whileRunning = await startReviewLocked(await startInput({ aiDailyCallLimit: limit }));
    expect(whileRunning.outcome).toBe("budget");

    // it made 3 calls and finished: 13 calls go back to the budget
    await seedCalls(3, first.review.id);
    await prisma.review.update({ where: { id: first.review.id }, data: { status: "COMPLETE" } });

    const afterwards = await startReviewLocked(await startInput({ aiDailyCallLimit: limit }));
    expect(afterwards.outcome).toBe("created");
    if (afterwards.outcome === "created") liveReviewIds.push(afterwards.review.id);
  });

  test("two starts on different debates at the same moment with room for one: exactly one is created", async () => {
    const limit = await limitWithRoomFor(1);
    const inputA = await startInput({ aiDailyCallLimit: limit });
    const inputB = await startInput({ aiDailyCallLimit: limit });

    const results = await Promise.all([startReviewLocked(inputA), startReviewLocked(inputB)]);

    const outcomes = [results[0].outcome, results[1].outcome].sort();
    expect(outcomes).toEqual(["budget", "created"]);
    for (const result of results) {
      if (result.outcome === "created") liveReviewIds.push(result.review.id);
    }
  });

  test("a stuck review older than 4 minutes doesn't block new starts", async () => {
    const limit = await limitWithRoomFor(1);
    await seedReview({ status: "RUNNING", minutesAgo: 5 });

    const result = await startReviewLocked(await startInput({ aiDailyCallLimit: limit }));

    expect(result.outcome).toBe("created");
    if (result.outcome === "created") liveReviewIds.push(result.review.id);
  });

  test("the fan cap refuses a fan's 4th review in 24h and says when a slot frees up", async () => {
    const fan = await prisma.user.create({
      data: { id: `budget-fan-${crypto.randomUUID()}`, email: `budget-fan-${crypto.randomUUID()}@varroom.test`, name: "Fan" },
    });
    // 3 counted reviews (the oldest 2 hours ago), plus a failed one that doesn't count
    await seedReview({ status: "COMPLETE", minutesAgo: 120, requestedById: fan.id });
    await seedReview({ status: "COMPLETE", minutesAgo: 60, requestedById: fan.id });
    await seedReview({ status: "COMPLETE", minutesAgo: 30, requestedById: fan.id });
    await seedReview({ status: "FAILED", minutesAgo: 10, requestedById: fan.id });
    const oldest = await prisma.review.findFirstOrThrow({
      where: { requestedById: fan.id, status: "COMPLETE" },
      orderBy: { createdAt: "asc" },
    });
    const input = await startInput({ requestedById: fan.id, fanDailyLimit: 3 });

    const result = await startReviewLocked(input);

    expect(result.outcome).toBe("fan_cap");
    if (result.outcome !== "fan_cap") return;
    expect(result.retryAt.toISOString()).toBe(new Date(oldest.createdAt.getTime() + 24 * HOUR_MS).toISOString());
    const count = await prisma.review.count({ where: { debateId: input.debateId } });
    expect(count).toBe(0);
  });

  test("a fan over the cap (the limit was lowered) is told when enough reviews have aged out", async () => {
    const fan = await prisma.user.create({
      data: { id: `budget-over-${crypto.randomUUID()}`, email: `budget-over-${crypto.randomUUID()}@varroom.test`, name: "Fan" },
    });
    // 5 counted reviews, but the limit is now 3: the 3rd oldest has to age out
    // before only 2 are left and the fan has a slot again
    for (const minutesAgo of [300, 240, 180, 120, 60]) {
      await seedReview({ status: "COMPLETE", minutesAgo: minutesAgo, requestedById: fan.id });
    }
    const counted = await prisma.review.findMany({
      where: { requestedById: fan.id },
      orderBy: { createdAt: "asc" },
    });
    const thirdOldest = counted[2]!;

    const result = await startReviewLocked(await startInput({ requestedById: fan.id, fanDailyLimit: 3 }));

    expect(result.outcome).toBe("fan_cap");
    if (result.outcome !== "fan_cap") return;
    expect(result.retryAt.toISOString()).toBe(new Date(thirdOldest.createdAt.getTime() + 24 * HOUR_MS).toISOString());
  });

  test("the fan cap is skipped when no fan limit is given (admins and the cli)", async () => {
    const fan = await prisma.user.create({
      data: { id: `budget-admin-${crypto.randomUUID()}`, email: `budget-admin-${crypto.randomUUID()}@varroom.test`, name: "Admin" },
    });
    await seedReview({ status: "COMPLETE", minutesAgo: 30, requestedById: fan.id });
    await seedReview({ status: "COMPLETE", minutesAgo: 20, requestedById: fan.id });
    await seedReview({ status: "COMPLETE", minutesAgo: 10, requestedById: fan.id });

    const result = await startReviewLocked(await startInput({ requestedById: fan.id, fanDailyLimit: null }));

    expect(result.outcome).toBe("created");
    if (result.outcome === "created") liveReviewIds.push(result.review.id);
  });

  test("skipping the fan cap never skips the budget", async () => {
    const limit = (await limitWithRoomFor(1)) - 1;

    const result = await startReviewLocked(await startInput({ fanDailyLimit: null, aiDailyCallLimit: limit }));

    expect(result.outcome).toBe("budget");
  });

  test("a fan at the cap is told about the cap first, even when the budget is out too", async () => {
    const fan = await prisma.user.create({
      data: { id: `budget-both-${crypto.randomUUID()}`, email: `budget-both-${crypto.randomUUID()}@varroom.test`, name: "Fan" },
    });
    await seedReview({ status: "COMPLETE", minutesAgo: 30, requestedById: fan.id });
    const limit = (await limitWithRoomFor(1)) - 1;

    const result = await startReviewLocked(
      await startInput({ requestedById: fan.id, fanDailyLimit: 1, aiDailyCallLimit: limit }),
    );

    expect(result.outcome).toBe("fan_cap");
  });
});
