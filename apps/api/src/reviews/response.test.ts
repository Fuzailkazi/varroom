import { describe, expect, test } from "bun:test";
import type { ReviewDetailClaim, ReviewDetailEvidence, ReviewDetailRow, ReviewStateRow } from "@varroom/db";
import { finalEventFromState, publicFailure, toReviewResponse } from "./response.ts";

// response.ts turns saved review rows into what the public sees.
// everything here is pure, so these are plain unit tests with no db

// test rows

function reviewState(overrides: Partial<ReviewStateRow> = {}): ReviewStateRow {
  return {
    id: "review-1",
    debateId: "debate-1",
    status: "COMPLETE",
    decision: "CONFIRMED",
    credibilityScore: 80,
    summary: "1 claim: 1 stands",
    failureReason: null,
    ...overrides,
  };
}

function claimRow(overrides: Partial<ReviewDetailClaim> = {}): ReviewDetailClaim {
  return {
    order: 1,
    claimText: "Bellingham is better as a false 9",
    type: "POSITIONAL_ROLE",
    entities: { player: "Bellingham", positionA: "false 9", positionB: "8" },
    verdict: "VERIFIED",
    reasoning: "Two sources agree.",
    confidence: 0.8,
    citedLabels: ["E1"],
    ...overrides,
  };
}

function evidenceRow(overrides: Partial<ReviewDetailEvidence> = {}): ReviewDetailEvidence {
  return {
    label: "E1",
    args: { claimOrder: 1, query: "Bellingham false 9" },
    kind: "WEB",
    sourceUrl: "https://fotmob.com/a",
    sourceTitle: "fotmob.com",
    publishedAt: null,
    error: null,
    ...overrides,
  };
}

function detailRow(overrides: Partial<ReviewDetailRow> = {}): ReviewDetailRow {
  return {
    id: "3f1c2a4e-0000-4000-8000-000000000001",
    debateId: "3f1c2a4e-0000-4000-8000-000000000002",
    status: "COMPLETE",
    decision: "CONFIRMED",
    credibilityScore: 80,
    summary: "1 claim: 1 stands",
    failureReason: null,
    createdAt: new Date("2026-09-27T10:00:00.000Z"),
    startedAt: new Date("2026-09-27T10:00:01.000Z"),
    completedAt: new Date("2026-09-27T10:00:30.000Z"),
    claims: [claimRow()],
    evidence: [evidenceRow()],
    ...overrides,
  };
}

describe("publicFailure", () => {
  test("the three AI steps all show up as an AI service problem", () => {
    expect(publicFailure("moderator: bad json").category).toBe("ai_service");
    expect(publicFailure("fact_checker: Gemini error 503").category).toBe("ai_service");
    expect(publicFailure("search: Every search failed").category).toBe("ai_service");
  });

  test("a timeout and a restart keep their own category", () => {
    expect(publicFailure("timeout: still running after 180s").category).toBe("timeout");
    expect(publicFailure("restart: interrupted by a server restart").category).toBe("restart");
  });

  test("anything else, like a failed save, is internal", () => {
    expect(publicFailure("persist: unique violation").category).toBe("internal");
    expect(publicFailure("internal: debate was deleted").category).toBe("internal");
  });

  test("a missing or oddly shaped reason is internal, not a crash", () => {
    expect(publicFailure(null).category).toBe("internal");
    expect(publicFailure("").category).toBe("internal");
    expect(publicFailure("timeout").category).toBe("internal"); // no colon, so no kind
    expect(publicFailure(": nothing before the colon").category).toBe("internal");
  });

  test("the kind must match exactly, so a look alike prefix is internal", () => {
    expect(publicFailure("Moderator: capital M").category).toBe("internal");
    expect(publicFailure("search_tool: close but not the same").category).toBe("internal");
  });

  test("each category comes with its fixed friendly message", () => {
    expect(publicFailure("timeout: x").message).toBe("The check timed out.");
    expect(publicFailure("search: x").message).toBe("The AI service had a problem.");
    expect(publicFailure("restart: x").message).toBe("The server restarted during the check.");
    expect(publicFailure("persist: x").message).toBe("Something went wrong on our side.");
  });

  test("the raw error text never ends up in what the public sees", () => {
    const failure = publicFailure("search: Gemini error 429: quota exceeded for model gemini-2.5-flash");

    const shown = JSON.stringify(failure);
    expect(shown).not.toContain("429");
    expect(shown).not.toContain("quota");
    expect(shown).not.toContain("gemini");
  });
});

describe("finalEventFromState", () => {
  test("a complete review becomes review_completed with its score, decision and summary", () => {
    const message = finalEventFromState(reviewState());

    expect(message).toEqual({
      event: "review_completed",
      id: null,
      data: {
        reviewId: "review-1",
        status: "COMPLETE",
        decision: "CONFIRMED",
        credibilityScore: 80,
        summary: "1 claim: 1 stands",
      },
    });
  });

  test("a complete review with no score keeps the score null", () => {
    const message = finalEventFromState(reviewState({ decision: "INCONCLUSIVE", credibilityScore: null }));

    const data = message?.data as { credibilityScore: number | null; decision: string };
    expect(data.credibilityScore).toBeNull();
    expect(data.decision).toBe("INCONCLUSIVE");
  });

  test("a failed review becomes review_failed with only the public category", () => {
    const message = finalEventFromState(
      reviewState({ status: "FAILED", decision: null, credibilityScore: null, failureReason: "timeout: 180s" }),
    );

    expect(message).toEqual({
      event: "review_failed",
      id: null,
      data: {
        reviewId: "review-1",
        status: "FAILED",
        failure: { category: "timeout", message: "The check timed out." },
      },
    });
  });

  test("a review that is still queued or running has no final event yet", () => {
    expect(finalEventFromState(reviewState({ status: "QUEUED" }))).toBeNull();
    expect(finalEventFromState(reviewState({ status: "RUNNING" }))).toBeNull();
  });
});

describe("toReviewResponse", () => {
  test("a complete review shows its result and no failure", () => {
    const body = toReviewResponse(detailRow());

    expect(body.review.status).toBe("COMPLETE");
    expect(body.review.decision).toBe("CONFIRMED");
    expect(body.review.credibilityScore).toBe(80);
    expect(body.review.failure).toBeNull();
    expect(body.review.createdAt).toBe("2026-09-27T10:00:00.000Z");
    expect(body.review.completedAt).toBe("2026-09-27T10:00:30.000Z");
  });

  test("a failed review shows the public category, never the raw reason", () => {
    const row = detailRow({
      status: "FAILED",
      decision: null,
      credibilityScore: null,
      summary: null,
      failureReason: "moderator: Gemini error 503: high demand",
      claims: [],
      evidence: [],
    });

    const body = toReviewResponse(row);

    expect(body.review.failure).toEqual({ category: "ai_service", message: "The AI service had a problem." });
    expect(JSON.stringify(body)).not.toContain("503");
    expect(JSON.stringify(body)).not.toContain("failureReason");
  });

  test("a running review has no timestamps it hasn't reached yet", () => {
    const row = detailRow({
      status: "RUNNING",
      decision: null,
      credibilityScore: null,
      summary: null,
      completedAt: null,
      claims: [],
      evidence: [],
    });

    const body = toReviewResponse(row);

    expect(body.review.completedAt).toBeNull();
    expect(body.review.claims).toEqual([]);
    expect(body.review.evidence).toEqual([]);
  });

  test("an untestable claim shows UNTESTABLE, even though the db keeps it PENDING", () => {
    const row = detailRow({ claims: [claimRow({ type: "UNTESTABLE", verdict: "PENDING", citedLabels: [] })] });

    const claim = toReviewResponse(row).review.claims[0];

    expect(claim?.type).toBe("UNTESTABLE");
    expect(claim?.verdict).toBe("UNTESTABLE");
  });

  test("a claim keeps the player and positions the moderator found", () => {
    const claim = toReviewResponse(detailRow()).review.claims[0];

    expect(claim?.entities).toEqual({ player: "Bellingham", positionA: "false 9", positionB: "8" });
    expect(claim?.citedLabels).toEqual(["E1"]);
  });

  test("a claim with no second position leaves positionB out", () => {
    const row = detailRow({ claims: [claimRow({ entities: { player: "Pedri", positionA: "8" } })] });

    const claim = toReviewResponse(row).review.claims[0];

    expect(claim?.entities).toEqual({ player: "Pedri", positionA: "8" });
  });

  test("an old claim saved with empty or broken entities falls back to empty strings", () => {
    const row = detailRow({
      claims: [
        claimRow({ order: 1, entities: {} }),
        claimRow({ order: 2, entities: null }),
        claimRow({ order: 3, entities: { player: 7, positionA: ["9"] } }),
      ],
    });

    const claims = toReviewResponse(row).review.claims;

    for (const claim of claims) {
      expect(claim.entities).toEqual({ player: "", positionA: "" });
    }
  });

  test("evidence status: a usable source is ok", () => {
    const evidence = toReviewResponse(detailRow()).review.evidence[0];

    expect(evidence?.status).toBe("ok");
  });

  test("evidence status: a search that found nothing is no_sources", () => {
    const row = detailRow({
      evidence: [evidenceRow({ sourceUrl: null, sourceTitle: null, error: "No sources returned" })],
    });

    const evidence = toReviewResponse(row).review.evidence[0];

    expect(evidence?.status).toBe("no_sources");
  });

  test("evidence status: a search that threw is search_failed, and its error text stays hidden", () => {
    const row = detailRow({
      evidence: [evidenceRow({ sourceUrl: null, sourceTitle: null, error: "Gemini error 429: quota exceeded" })],
    });

    const body = toReviewResponse(row);

    expect(body.review.evidence[0]?.status).toBe("search_failed");
    expect(JSON.stringify(body)).not.toContain("quota");
  });

  test("evidence carries the claim it was gathered for, and 0 when that's missing", () => {
    const row = detailRow({
      evidence: [
        evidenceRow({ label: "E1", args: { claimOrder: 2, query: "q" } }),
        evidenceRow({ label: "E2", args: null }),
        evidenceRow({ label: "E3", args: { claimOrder: "2" } }),
      ],
    });

    const evidence = toReviewResponse(row).review.evidence;

    expect(evidence[0]?.claimOrder).toBe(2);
    expect(evidence[1]?.claimOrder).toBe(0);
    expect(evidence[2]?.claimOrder).toBe(0);
  });

  test("the search query stays internal and isn't part of the evidence shown", () => {
    const evidence = toReviewResponse(detailRow()).review.evidence[0];

    expect(Object.keys(evidence ?? {})).not.toContain("args");
    expect(JSON.stringify(evidence)).not.toContain("Bellingham false 9");
  });

  test("a published date is sent as an ISO string", () => {
    const row = detailRow({ evidence: [evidenceRow({ publishedAt: new Date("2026-05-01T00:00:00.000Z") })] });

    const evidence = toReviewResponse(row).review.evidence[0];

    expect(evidence?.publishedAt).toBe("2026-05-01T00:00:00.000Z");
  });
});
