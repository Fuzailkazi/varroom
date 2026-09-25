import { describe, expect, test } from "bun:test";
import { Comment, CreateCommentRequest, ListCommentsQuery } from "./comments.ts";

// schema tests, no db

describe("CreateCommentRequest", () => {
  test("trims the body and turns windows line breaks into \\n, keeping line breaks", () => {
    const result = CreateCommentRequest.parse({ body: "  Wrong.\r\nHe is a 10.  " });
    expect(result.body).toBe("Wrong.\nHe is a 10.");
  });

  test("refuses an empty, whitespace only or missing body", () => {
    expect(CreateCommentRequest.safeParse({ body: "" }).success).toBe(false);
    expect(CreateCommentRequest.safeParse({ body: "   \n  " }).success).toBe(false);
    expect(CreateCommentRequest.safeParse({}).success).toBe(false);
  });

  test("280 characters is fine, 281 is not", () => {
    expect(CreateCommentRequest.safeParse({ body: "a".repeat(280) }).success).toBe(true);
    const tooLong = CreateCommentRequest.safeParse({ body: "a".repeat(281) });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0]?.path.join(".")).toBe("body");
    }
  });

  test("counts the length after trimming", () => {
    // 280 letters plus spaces around them still passes
    expect(CreateCommentRequest.safeParse({ body: `   ${"a".repeat(280)}   ` }).success).toBe(true);
  });

  test("ignores unknown fields", () => {
    const result = CreateCommentRequest.parse({ body: "Fair point.", debateId: "x" });
    expect("debateId" in result).toBe(false);
  });
});

describe("ListCommentsQuery", () => {
  test("defaults limit to 20 and leaves cursor undefined", () => {
    const result = ListCommentsQuery.parse({});
    expect(result.limit).toBe(20);
    expect(result.cursor).toBeUndefined();
  });

  test("limit comes in as text, must be 1 to 50", () => {
    expect(ListCommentsQuery.parse({ limit: "50" }).limit).toBe(50);
    expect(ListCommentsQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(ListCommentsQuery.safeParse({ limit: "51" }).success).toBe(false);
    expect(ListCommentsQuery.safeParse({ limit: "abc" }).success).toBe(false);
  });

  test("passes the cursor through untouched", () => {
    expect(ListCommentsQuery.parse({ cursor: "abc" }).cursor).toBe("abc");
  });
});

describe("Comment shape", () => {
  test("accepts a comment with a deleted author", () => {
    const result = Comment.safeParse({
      id: "280c06dd-a9f8-41a7-9151-d348a6a7e295",
      debateId: "6e7c7d49-26ed-42c3-8dab-1857a8d97d5e",
      body: "Nonsense.",
      author: { username: null, displayUsername: null, displayName: "deleted user", badge: null },
      createdAt: "2026-09-25T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});
