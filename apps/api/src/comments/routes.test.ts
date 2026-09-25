import { describe, expect, test } from "bun:test";
import type { CommentRow } from "@varroom/db";
import { toCommentResponse } from "./routes.ts";

// db row -> Comment json mapper. rows built by hand, no db

const CREATED = new Date("2026-09-25T09:30:00.000Z");

function fakeRow(changes: Partial<CommentRow> = {}): CommentRow {
  const row: CommentRow = {
    id: "5a1b2c3d-0000-4000-8000-000000000001",
    debateId: "280c06dd-a9f8-41a7-9151-d348a6a7e295",
    authorId: "user_1",
    body: "Wrong.\nHe is a 10.",
    createdAt: CREATED,
    author: { username: "jude_fan", displayUsername: "Jude_Fan", name: "Jude", badge: "SPECTATOR" },
  };
  return { ...row, ...changes };
}

describe("toCommentResponse", () => {
  test("copies id, debate id and body, formats the date as ISO", () => {
    const comment = toCommentResponse(fakeRow());
    expect(comment.id).toBe("5a1b2c3d-0000-4000-8000-000000000001");
    expect(comment.debateId).toBe("280c06dd-a9f8-41a7-9151-d348a6a7e295");
    expect(comment.body).toBe("Wrong.\nHe is a 10."); // line breaks kept
    expect(comment.createdAt).toBe("2026-09-25T09:30:00.000Z");
  });

  test("shows the author like a debate does", () => {
    const comment = toCommentResponse(fakeRow());
    expect(comment.author).toEqual({ username: "jude_fan", displayUsername: "Jude_Fan", displayName: "Jude", badge: "SPECTATOR" });
  });

  test("labels a deleted account as deleted user", () => {
    const comment = toCommentResponse(fakeRow({ authorId: null, author: null }));
    expect(comment.author).toEqual({ username: null, displayUsername: null, displayName: "deleted user", badge: null });
  });

  test("does not leak the raw author id or anything else", () => {
    const comment = toCommentResponse(fakeRow());
    expect(Object.keys(comment).sort()).toEqual(["author", "body", "createdAt", "debateId", "id"]);
  });
});
