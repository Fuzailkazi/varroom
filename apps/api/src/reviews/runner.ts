import { EventEmitter } from "node:events";
import { addReviewEvent, failInterruptedReviews, finishReviewFailed, getDebateText, getReviewState } from "@varroom/db";
import { runReview } from "@varroom/agents";
import type { RunAgentFn, SearchWebFn } from "@varroom/agents";
import { REVIEW_TIMEOUT_MS } from "@varroom/shared";
import { failedEvent, finalEventFromState, publicFailure } from "./response.ts";
import type { StreamMessage } from "./response.ts";

// runs reviews inside the api process, in the background, and tells open streams
// what happened. single process only: a restart fails whatever was running

export type ReviewRunnerOptions = {
  runAgentFn?: RunAgentFn; // tests swap in fake agents
  searchWebFn?: SearchWebFn; // tests swap in a fake search
  timeoutMs?: number; // tests use a short timeout
  retryDelayMs?: number; // tests skip the wait between gemini retries
};

// what one background run keeps track of
type RunState = {
  reviewId: string;
  startedAt: number;
  finalSent: boolean; // the final event goes out once per run
};

export type ReviewRunner = {
  // starts the review and returns right away
  start: (reviewId: string, debateId: string) => void;
  // listens for one review's messages. call the returned function to stop listening
  subscribe: (reviewId: string, listener: (message: StreamMessage) => void) => () => void;
};

export function createReviewRunner(options: ReviewRunnerOptions = {}): ReviewRunner {
  // one emitter for all reviews, the event name is the review id
  const bus = new EventEmitter();
  bus.setMaxListeners(0); // many viewers can watch one review

  let timeoutMs = REVIEW_TIMEOUT_MS;
  if (options.timeoutMs !== undefined) {
    timeoutMs = options.timeoutMs;
  }

  function publish(reviewId: string, message: StreamMessage) {
    bus.emit(reviewId, message);
  }

  function subscribe(reviewId: string, listener: (message: StreamMessage) => void) {
    bus.on(reviewId, listener);
    return () => {
      bus.off(reviewId, listener);
    };
  }

  function start(reviewId: string, debateId: string) {
    const run: RunState = { reviewId: reviewId, startedAt: Date.now(), finalSent: false };
    runInBackground(run, debateId).catch(async (err) => {
      console.error(`review ${reviewId}: runner crashed`, err);
      await failAfterCrash(run);
    });
  }

  // every path ends by sending one final event, built from what's saved in the db
  async function sendFinal(run: RunState) {
    if (run.finalSent) {
      return;
    }
    run.finalSent = true;
    const reviewId = run.reviewId;

    const state = await getReviewState(reviewId);
    if (!state) {
      // the debate (and with it the review) was deleted mid run
      publish(reviewId, failedEvent(reviewId, publicFailure(null)));
      console.log(`review ${reviewId}: deleted while running`);
      return;
    }
    const message = finalEventFromState(state);
    if (message) {
      publish(reviewId, message);
    }
    const seconds = Math.round((Date.now() - run.startedAt) / 1000);
    console.log(`review ${reviewId}: ${state.status} after ${seconds}s (${state.failureReason ?? state.decision})`);
  }

  // something outside the pipeline threw (e.g. loading the debate text).
  // fail the review so it never sits QUEUED forever, and tell the open streams
  async function failAfterCrash(run: RunState) {
    try {
      await finishReviewFailed(run.reviewId, "internal: runner crashed");
      // the crash may have hit sendFinal itself before it published, so send it again
      run.finalSent = false;
      await sendFinal(run);
    } catch (err) {
      console.error(`review ${run.reviewId}: could not fail it after the crash`, err);
    }
  }

  async function runInBackground(run: RunState, debateId: string) {
    const reviewId = run.reviewId;

    // 1. the text to review. null = the debate is already gone
    const text = await getDebateText(debateId);
    if (text === null) {
      await finishReviewFailed(reviewId, "internal: debate was deleted before the review started");
      await sendFinal(run);
      return;
    }

    // 2. the timeout fails the review. a result that shows up later is dropped by the db
    let timedOut = false;
    const timer = setTimeout(async () => {
      timedOut = true;
      try {
        await finishReviewFailed(reviewId, `timeout: still running after ${Math.round(timeoutMs / 1000)}s`);
        await sendFinal(run);
      } catch (err) {
        console.error(`review ${reviewId}: could not time it out`, err);
      }
    }, timeoutMs);

    // 3. run the agents, saving and streaming the claims as soon as the moderator has them
    console.log(`review ${reviewId}: started`);
    try {
      await runReview(reviewId, text, {
        runAgentFn: options.runAgentFn,
        searchWebFn: options.searchWebFn,
        retryDelayMs: options.retryDelayMs,
        // once timed out, the review holds no daily budget, so no new gemini attempt may start
        shouldStop: () => timedOut,
        onClaimsExtracted: async (claims) => {
          if (timedOut) {
            return;
          }
          const payload = { reviewId: reviewId, claims: toClaimSummaries(claims) };
          const eventId = await addReviewEvent(reviewId, 1, "claims_extracted", payload);
          publish(reviewId, { event: "claims_extracted", id: eventId, data: payload });
        },
      });
    } catch (err) {
      // runReview already marked it FAILED (or the review is gone). the final event says which
      console.error(`review ${reviewId}: pipeline error`, err);
    } finally {
      clearTimeout(timer);
    }

    await sendFinal(run);
  }

  return { start: start, subscribe: subscribe };
}

// on api start: fail every review a previous process left running
export async function recoverInterruptedReviews(): Promise<void> {
  const ids = await failInterruptedReviews("restart: interrupted by a server restart");
  if (ids.length > 0) {
    console.log(`failed ${ids.length} review(s) left running by the last process`);
  }
}

// helpers

type ClaimSummary = {
  order: number;
  claimText: string;
  type: "POSITIONAL_ROLE" | "UNTESTABLE";
};

// the claims_extracted event only carries the basics of each claim
function toClaimSummaries(claims: ClaimSummary[]): ClaimSummary[] {
  const summaries: ClaimSummary[] = [];
  for (const claim of claims) {
    summaries.push({ order: claim.order, claimText: claim.claimText, type: claim.type });
  }
  return summaries;
}
