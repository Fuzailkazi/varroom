import { describe, expect, test } from "bun:test";
import type { DebateRow } from "@varroom/db";
import { toDebateResponse } from "./response.ts";

// db row -> Debate json mapper. rows built by hand, no db

const CREATED = new Date("2026-09-24T16:00:00.000Z");

// row like getDebatesByIds returns: live author, no review. tests override what they need
function fakeRow(changes: Partial<DebateRow> = {}): DebateRow {
  const row: DebateRow = {
    id: "280c06dd-a9f8-41a7-9151-d348a6a7e295",
    authorId: "user_1",
    title: "Arsenal need a striker now",
    thesis: "They create enough chances but miss too many of them.",
    categories: ["TRANSFER"],
    focusPlayerId: null,
    upVotes: 3,
    downVotes: 1,
    voteScore: 2,
    commentCount: 4,
    credibilityScore: 55,
    createdAt: CREATED,
    updatedAt: CREATED,
    author: { username: "jude_fan", displayUsername: "Jude_Fan", name: "Jude", badge: "SPECTATOR" },
    tags: [],
    reviews: [],
  };
  return { ...row, ...changes };
}

function tagLink(slug: string, name: string, kind: "TEAM" | "LEAGUE") {
  return { debateId: "280c06dd-a9f8-41a7-9151-d348a6a7e295", tagId: 1, tag: { id: 1, slug: slug, name: name, kind: kind } };
}

describe("toDebateResponse", () => {
  test("copies the fields and counters and formats dates as ISO strings", () => {
    const debate = toDebateResponse(fakeRow(), undefined);
    expect(debate.id).toBe("280c06dd-a9f8-41a7-9151-d348a6a7e295");
    expect(debate.title).toBe("Arsenal need a striker now");
    expect(debate.categories).toEqual(["TRANSFER"]);
    expect(debate.upVotes).toBe(3);
    expect(debate.downVotes).toBe(1);
    expect(debate.voteScore).toBe(2);
    expect(debate.commentCount).toBe(4);
    expect(debate.credibilityScore).toBe(55);
    expect(debate.createdAt).toBe("2026-09-24T16:00:00.000Z");
    expect(debate.latestReview).toBeNull();
  });

  test("shows the author with their display username and badge", () => {
    const debate = toDebateResponse(fakeRow(), undefined);
    expect(debate.author).toEqual({ username: "jude_fan", displayUsername: "Jude_Fan", displayName: "Jude", badge: "SPECTATOR" });
  });

  test("falls back to the username when there is no display username, like /api/me", () => {
    const row = fakeRow({ author: { username: "jude_fan", displayUsername: null, name: "Jude", badge: "CHIEF_VAR" } });
    const debate = toDebateResponse(row, undefined);
    expect(debate.author.displayUsername).toBe("jude_fan");
  });

  test("labels a deleted account as 'deleted user' with null fields", () => {
    const debate = toDebateResponse(fakeRow({ authorId: null, author: null }), undefined);
    expect(debate.author).toEqual({ username: null, displayUsername: null, displayName: "deleted user", badge: null });
  });

  test("lists tags leagues first, then teams, each A to Z", () => {
    const row = fakeRow({
      tags: [tagLink("chelsea", "Chelsea", "TEAM"), tagLink("premier-league", "Premier League", "LEAGUE"), tagLink("arsenal", "Arsenal", "TEAM")],
    });
    const debate = toDebateResponse(row, undefined);
    expect(debate.tags.map((tag) => tag.slug)).toEqual(["premier-league", "arsenal", "chelsea"]);
  });

  test("a QUEUED review shows with null decision, score, summary and completedAt", () => {
    const row = fakeRow({
      reviews: [{ id: "rev_1", status: "QUEUED", decision: null, credibilityScore: null, summary: null, createdAt: CREATED, completedAt: null }],
    });
    const debate = toDebateResponse(row, undefined);
    expect(debate.latestReview).toEqual({
      id: "rev_1",
      status: "QUEUED",
      decision: null,
      credibilityScore: null,
      summary: null,
      createdAt: "2026-09-24T16:00:00.000Z",
      completedAt: null,
    });
  });

  test("a COMPLETE review shows its decision, score, summary and completion time", () => {
    const done = new Date("2026-09-24T16:05:00.000Z");
    const row = fakeRow({
      reviews: [{ id: "rev_2", status: "COMPLETE", decision: "OVERTURNED", credibilityScore: 31, summary: "Nope.", createdAt: CREATED, completedAt: done }],
    });
    const debate = toDebateResponse(row, undefined);
    expect(debate.latestReview?.decision).toBe("OVERTURNED");
    expect(debate.latestReview?.credibilityScore).toBe(31);
    expect(debate.latestReview?.summary).toBe("Nope.");
    expect(debate.latestReview?.completedAt).toBe("2026-09-24T16:05:00.000Z");
  });
});

describe("myVote", () => {
  test("is 1 or -1 when the viewer voted", () => {
    expect(toDebateResponse(fakeRow(), 1).myVote).toBe(1);
    expect(toDebateResponse(fakeRow(), -1).myVote).toBe(-1);
  });

  test("is null with no vote, and for any value that is not 1 or -1", () => {
    expect(toDebateResponse(fakeRow(), undefined).myVote).toBeNull();
    expect(toDebateResponse(fakeRow(), 0).myVote).toBeNull();
    expect(toDebateResponse(fakeRow(), 5).myVote).toBeNull();
  });
});
