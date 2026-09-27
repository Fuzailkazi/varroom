import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  createReview,
  debateExists,
  findLiveReview,
  getReviewCapUsage,
  getReviewDetail,
  getReviewState,
  listReviewEventsAfter,
} from "@varroom/db";
import type { ReviewSummaryRow } from "@varroom/db";
import { geminiModel } from "@varroom/agents";
import { REVIEW_DAILY_LIMIT, REVIEW_LIMIT_WINDOW_MS, REVIEW_TIMEOUT_MS, StartReviewResponse } from "@varroom/shared";
import { requireVerified } from "../auth/guards.ts";
import { sendError } from "../errors.ts";
import { failedEvent, finalEventFromState, publicFailure, toReviewResponse } from "./response.ts";
import type { StreamMessage } from "./response.ts";
import type { ReviewRunner } from "./runner.ts";

// review api: start a review, load the verdict, watch it live

const Uuid = z.uuid();
const HEARTBEAT_MS = 15 * 1000; // keeps proxies from closing a quiet stream
const MAX_STREAM_MS = REVIEW_TIMEOUT_MS + 60 * 1000; // no stream outlives its review by much

// post /api/debates/:id/reviews
export function createStartReviewRouter(runner: ReviewRunner) {
  const router = Router({ mergeParams: true });
  router.post("/", requireVerified, async (req: Request, res: Response) => {
    await startReviewHandler(req, res, runner);
  });
  return router;
}

// get /api/reviews/:id and /api/reviews/:id/events. both public
export function createReviewsRouter(runner: ReviewRunner) {
  const router = Router();
  router.get("/:id", getReviewHandler);
  router.get("/:id/events", async (req: Request, res: Response) => {
    await streamReviewHandler(req, res, runner);
  });
  return router;
}

// helpers

function sendReview(res: Response, status: number, review: ReviewSummaryRow) {
  const body = StartReviewResponse.parse({
    review: {
      id: review.id,
      debateId: review.debateId,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
    },
  });
  res.status(status).json(body);
}

// post /api/debates/:id/reviews

async function startReviewHandler(req: Request, res: Response, runner: ReviewRunner) {
  // requireVerified already ran, so signedIn is set and email is confirmed
  const userId = req.signedIn!.user.id;
  const debateId = String(req.params.id);

  // 1. the debate must exist
  if (!Uuid.safeParse(debateId).success) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }
  const exists = await debateExists(debateId);
  if (!exists) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }

  // 2. one verdict per debate: a running or finished review is returned as is,
  // and it doesn't cost the fan a slot
  const live = await findLiveReview(debateId);
  if (live) {
    sendReview(res, 200, live);
    return;
  }

  // 3. daily cap so one fan can't burn the ai budget. failed reviews don't count
  const windowStart = new Date(Date.now() - REVIEW_LIMIT_WINDOW_MS);
  const usage = await getReviewCapUsage(userId, windowStart);
  if (usage.count >= REVIEW_DAILY_LIMIT && usage.oldestCreatedAt) {
    // a slot frees up when the oldest counted review turns 24h old
    const retryAt = new Date(usage.oldestCreatedAt.getTime() + REVIEW_LIMIT_WINDOW_MS);
    let retryAfterSeconds = Math.ceil((retryAt.getTime() - Date.now()) / 1000);
    if (retryAfterSeconds < 1) {
      retryAfterSeconds = 1;
    }
    res.set("Retry-After", String(retryAfterSeconds));
    sendError(res, 429, "REVIEW_LIMIT_REACHED", `You can start ${REVIEW_DAILY_LIMIT} reviews a day. Try again later.`, {
      retryAt: retryAt.toISOString(),
    });
    return;
  }

  // 4. create it. if someone else created one a moment ago, the db hands us theirs
  const created = await createReview({ debateId: debateId, model: geminiModel(), requestedById: userId });
  if (created.outcome === "exists") {
    sendReview(res, 200, created.review);
    return;
  }

  // 5. run it in the background and answer straight away
  runner.start(created.review.id, debateId);
  sendReview(res, 202, created.review);
}

// get /api/reviews/:id

async function getReviewHandler(req: Request, res: Response) {
  const reviewId = String(req.params.id);
  if (!Uuid.safeParse(reviewId).success) {
    sendError(res, 404, "NOT_FOUND", "No such review.");
    return;
  }

  const row = await getReviewDetail(reviewId);
  if (!row) {
    sendError(res, 404, "NOT_FOUND", "No such review.");
    return;
  }
  res.json(toReviewResponse(row));
}

// get /api/reviews/:id/events (server sent events)

// writes one sse message: optional id line, event name, json data, blank line
function writeMessage(res: Response, message: StreamMessage) {
  if (message.id !== null) {
    res.write(`id: ${message.id}\n`);
  }
  res.write(`event: ${message.event}\n`);
  res.write(`data: ${JSON.stringify(message.data)}\n\n`);
}

// Last-Event-ID header as a bigint, or null when missing or not a number
function readLastEventId(req: Request): bigint | null {
  const header = req.headers["last-event-id"];
  if (typeof header !== "string") {
    return null;
  }
  if (!/^\d+$/.test(header)) {
    return null;
  }
  return BigInt(header);
}

async function streamReviewHandler(req: Request, res: Response, runner: ReviewRunner) {
  const reviewId = String(req.params.id);

  // 1. unknown or malformed id -> plain json 404, before any stream starts
  if (!Uuid.safeParse(reviewId).success) {
    sendError(res, 404, "NOT_FOUND", "No such review.");
    return;
  }
  const state = await getReviewState(reviewId);
  if (!state) {
    sendError(res, 404, "NOT_FOUND", "No such review.");
    return;
  }

  // 2. open the stream
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // stops proxies from holding events back
  });
  res.flushHeaders();

  // already over: send the one final event and close
  const finalNow = finalEventFromState(state);
  if (finalNow) {
    writeMessage(res, finalNow);
    res.end();
    return;
  }

  // 3. listen first, then replay what's saved. anything that arrives meanwhile
  // is buffered, so nothing slips through the gap between the two
  let replaying = true;
  let closed = false;
  const buffered: StreamMessage[] = [];
  const sentIds = new Set<string>();

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    clearTimeout(maxAge);
    res.end();
  }

  // sends one message unless it's a repeat, and closes after the final one
  function deliver(message: StreamMessage) {
    if (closed) {
      return;
    }
    if (message.id !== null) {
      if (sentIds.has(message.id)) {
        return;
      }
      sentIds.add(message.id);
    }
    writeMessage(res, message);
    if (message.event === "review_completed" || message.event === "review_failed") {
      close();
    }
  }

  const unsubscribe = runner.subscribe(reviewId, (message) => {
    if (replaying) {
      buffered.push(message);
    } else {
      deliver(message);
    }
  });

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, HEARTBEAT_MS);

  // hard cap. a reconnect after this gets the final event from the db
  const maxAge = setTimeout(close, MAX_STREAM_MS);

  req.on("close", close);

  // 4. replay saved events the client hasn't seen yet
  const saved = await listReviewEventsAfter(reviewId, readLastEventId(req));
  for (const event of saved) {
    // claims_extracted is the only event we save today, skip anything else
    if (event.type === "claims_extracted") {
      deliver({ event: "claims_extracted", id: event.id, data: event.payload });
    }
  }

  // 5. then whatever arrived while we were replaying
  replaying = false;
  for (const message of buffered) {
    deliver(message);
  }

  // 6. the review may have ended while we were replaying, before we started listening
  if (!closed) {
    const latest = await getReviewState(reviewId);
    if (!latest) {
      // deleted along with its debate
      deliver(failedEvent(reviewId, publicFailure(null)));
      return;
    }
    const finalLater = finalEventFromState(latest);
    if (finalLater) {
      deliver(finalLater);
    }
  }
}
