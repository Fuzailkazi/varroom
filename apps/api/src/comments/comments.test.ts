import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { prisma } from "@varroom/db/client";
import { Comment, Debate, ErrorResponse, ListCommentsResponse } from "@varroom/shared";
import { getLastEmail } from "../auth/email.ts";
import { Fan, newFanDetails } from "../testing/fan.ts";
import { startTestServer } from "../testing/server.ts";

// integration tests for comments. runs against the neon test branch
// (reset + seeded before each run), skipped without DATABASE_URL_TEST

const hasTestDatabase = Boolean(process.env.DATABASE_URL);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  if (!hasTestDatabase) return;
  const started = await startTestServer();
  server = started.server;
  baseUrl = started.baseUrl;
});

afterAll(() => {
  if (server) server.close();
});

// helpers

type TestFan = { fan: Fan; userId: string; password: string };

// signs up a fan. confirmed = also clicks the email link
async function newFan(confirmed: boolean): Promise<TestFan> {
  const fan = new Fan(baseUrl);
  const details = newFanDetails();
  const signUp = await fan.call("/api/auth/sign-up/email", { body: details });
  expect(signUp.status).toBe(200);

  if (confirmed) {
    const email = getLastEmail(details.email);
    expect(email).toBeDefined();
    await fetch(email!.url, { redirect: "manual" });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { email: details.email } });
  return { fan: fan, userId: user.id, password: details.password };
}

// a debate inserted directly, owned by authorId
async function newDebate(authorId: string): Promise<string> {
  const debate = await prisma.debate.create({
    data: {
      authorId: authorId,
      title: `Debate for comments ${crypto.randomUUID().slice(0, 8)}`,
      thesis: "A thesis with enough characters to satisfy the thirty character rule.",
      categories: ["OTHER"],
    },
  });
  return debate.id;
}

async function postComment(fan: Fan, debateId: string, body: unknown) {
  return fan.call(`/api/debates/${debateId}/comments`, { body: body });
}

async function errorOf(response: Response) {
  return ErrorResponse.parse(await response.json()).error;
}

async function commentCountOf(debateId: string): Promise<number> {
  const response = await new Fan(baseUrl).call(`/api/debates/${debateId}`);
  return Debate.parse(await response.json()).commentCount;
}

async function getPage(debateId: string, query: string) {
  const response = await new Fan(baseUrl).call(`/api/debates/${debateId}/comments?${query}`);
  expect(response.status).toBe(200);
  return ListCommentsResponse.parse(await response.json());
}

// inserts comments directly, a second apart so the order is predictable. newest first
async function insertComments(debateId: string, authorId: string, count: number): Promise<string[]> {
  const start = Date.now() - 60 * 60 * 1000;
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ debateId: debateId, authorId: authorId, body: `Inserted comment ${i}`, createdAt: new Date(start - i * 1000) });
  }
  const created = await prisma.comment.createManyAndReturn({ data: rows, select: { id: true, createdAt: true } });
  created.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  await prisma.debate.update({ where: { id: debateId }, data: { commentCount: count } });
  return idsOf(created);
}

// ids of a list, in order
function idsOf(items: { id: string }[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
  }
  return ids;
}

async function rawRequest(fan: Fan, method: string, path: string, headers: Record<string, string>, body?: string) {
  return fetch(baseUrl + path, { method: method, headers: { ...headers, Cookie: fan.cookieHeader() }, body: body });
}

// the tests

describe.skipIf(!hasTestDatabase)("comments API", () => {
  describe("posting", () => {
    test("a confirmed fan posts a comment; the body is cleaned and the count goes up", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);

      const response = await postComment(author.fan, debateId, { body: "  Wrong.\r\nHe is a 10.  ", debateId: "ignored" });
      expect(response.status).toBe(201);
      const comment = Comment.parse(await response.json());

      expect(comment.body).toBe("Wrong.\nHe is a 10.");
      expect(comment.debateId).toBe(debateId);
      expect(comment.author.displayName).not.toBe("deleted user");
      expect(comment.author.username).not.toBeNull();

      const row = await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } });
      expect(row.authorId).toBe(author.userId);
      expect(await commentCountOf(debateId)).toBe(1);
    });

    test("body rules: empty, spaces, 281 and missing fail on body; 280 passes", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);

      const bad: unknown[] = [{ body: "" }, { body: "   \n " }, { body: "a".repeat(281) }, {}];
      for (const body of bad) {
        const response = await postComment(author.fan, debateId, body);
        expect(response.status).toBe(400);
        const error = await errorOf(response);
        expect(error.code).toBe("VALIDATION_FAILED");
        expect(error.fields?.[0]?.path).toBe("body");
      }

      const ok = await postComment(author.fan, debateId, { body: "b".repeat(280) });
      expect(ok.status).toBe(201);
    });

    test("guards and precedence", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);

      const anonymous = await postComment(new Fan(baseUrl), debateId, { body: "Hi there." });
      expect(anonymous.status).toBe(401);
      expect((await errorOf(anonymous)).code).toBe("UNAUTHENTICATED");

      const unconfirmed = await newFan(false);
      const blocked = await postComment(unconfirmed.fan, debateId, { body: "Hi there." });
      expect(blocked.status).toBe(403);
      expect((await errorOf(blocked)).code).toBe("EMAIL_NOT_VERIFIED");

      const malformed = await postComment(author.fan, "abc", { body: "Hi there." });
      expect(malformed.status).toBe(404);
      expect((await errorOf(malformed)).code).toBe("NOT_FOUND");

      // malformed id wins over a bad body
      const both = await postComment(author.fan, "abc", { body: "" });
      expect(both.status).toBe(404);

      const unknown = await postComment(author.fan, crypto.randomUUID(), { body: "Hi there." });
      expect(unknown.status).toBe(404);

      // bad origin wins over everything, even with a broken body
      const evil = await rawRequest(author.fan, "POST", `/api/debates/${debateId}/comments`, { Origin: "https://evil.example", "Content-Type": "application/json" }, "{");
      expect(evil.status).toBe(403);
      expect((await errorOf(evil)).code).toBe("BAD_ORIGIN");
    });

    test("the same body twice within a minute is a duplicate; on another debate or after 2 minutes it is not", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);
      const otherDebateId = await newDebate(author.userId);

      const first = await postComment(author.fan, debateId, { body: "Same words." });
      const firstId = Comment.parse(await first.json()).id;

      const again = await postComment(author.fan, debateId, { body: "  Same words.  " });
      expect(again.status).toBe(409);
      const error = await errorOf(again);
      expect(error.code).toBe("DUPLICATE_COMMENT");
      expect(error.existingId).toBe(firstId);
      expect(await commentCountOf(debateId)).toBe(1);

      const elsewhere = await postComment(author.fan, otherDebateId, { body: "Same words." });
      expect(elsewhere.status).toBe(201);

      // an old identical comment does not count
      await prisma.comment.update({ where: { id: firstId }, data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) } });
      const later = await postComment(author.fan, debateId, { body: "Same words." });
      expect(later.status).toBe(201);
    });
  });

  describe("listing", () => {
    test("newest first, 25 comments paged by 10 with no repeats, even when a new one arrives between pages", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);
      const inserted = await insertComments(debateId, author.userId, 25);

      const page1 = await getPage(debateId, "limit=10");
      expect(idsOf(page1.items)).toEqual(inserted.slice(0, 10));
      expect(page1.nextCursor).not.toBeNull();

      // a new comment lands on top, page 2 still continues after page 1
      const posted = await postComment(author.fan, debateId, { body: "Late to the party." });
      expect(posted.status).toBe(201);

      const page2 = await getPage(debateId, `limit=10&cursor=${page1.nextCursor}`);
      const page3 = await getPage(debateId, `limit=10&cursor=${page2.nextCursor}`);
      expect(page3.nextCursor).toBeNull();

      const seen = [...idsOf(page1.items), ...idsOf(page2.items), ...idsOf(page3.items)];
      expect(seen).toEqual(inserted);
    });

    test("default limit is 20, and the list needs no session", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);
      await insertComments(debateId, author.userId, 21);
      const page = await getPage(debateId, "");
      expect(page.items.length).toBe(20);
      expect(page.nextCursor).not.toBeNull();
    });

    test("bad cursor, cursor from another debate, deleted cursor, bad limit, unknown debate", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);
      const otherDebateId = await newDebate(author.userId);
      const ids = await insertComments(debateId, author.userId, 3);
      const otherIds = await insertComments(otherDebateId, author.userId, 1);
      const anon = new Fan(baseUrl);

      const notAnId = await anon.call(`/api/debates/${debateId}/comments?cursor=abc`);
      expect(notAnId.status).toBe(400);
      expect((await errorOf(notAnId)).code).toBe("INVALID_CURSOR");

      const wrongDebate = await anon.call(`/api/debates/${debateId}/comments?cursor=${otherIds[0]}`);
      expect(wrongDebate.status).toBe(400);
      expect((await errorOf(wrongDebate)).code).toBe("INVALID_CURSOR");

      await prisma.comment.delete({ where: { id: ids[1]! } });
      const stale = await anon.call(`/api/debates/${debateId}/comments?cursor=${ids[1]}`);
      expect(stale.status).toBe(400);
      expect((await errorOf(stale)).code).toBe("INVALID_CURSOR");

      for (const limit of ["0", "51", "abc"]) {
        const response = await anon.call(`/api/debates/${debateId}/comments?limit=${limit}`);
        expect(response.status).toBe(400);
        expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
      }

      // malformed id wins over a bad limit
      const malformed = await anon.call("/api/debates/abc/comments?limit=0");
      expect(malformed.status).toBe(404);
      const unknown = await anon.call(`/api/debates/${crypto.randomUUID()}/comments`);
      expect(unknown.status).toBe(404);
    });

    test("a deleted author shows as deleted user", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);
      const [id] = await insertComments(debateId, author.userId, 1);
      await prisma.comment.update({ where: { id: id! }, data: { authorId: null } });

      const page = await getPage(debateId, "");
      expect(page.items[0]?.author).toEqual({ username: null, displayUsername: null, displayName: "deleted user", badge: null });
    });
  });

  describe("deleting", () => {
    test("only the comment's author can delete; the count goes back down", async () => {
      const poster = await newFan(true);
      const commenter = await newFan(false); // unverified, can still delete their own
      const other = await newFan(true);
      const debateId = await newDebate(poster.userId);

      const [id] = await insertComments(debateId, commenter.userId, 1);
      expect(await commentCountOf(debateId)).toBe(1);

      const byOther = await other.fan.call(`/api/comments/${id}`, { method: "DELETE" });
      expect(byOther.status).toBe(403);
      expect((await errorOf(byOther)).code).toBe("FORBIDDEN");

      // the debate's author has no extra power
      const byPoster = await poster.fan.call(`/api/comments/${id}`, { method: "DELETE" });
      expect(byPoster.status).toBe(403);

      const anonymous = await new Fan(baseUrl).call(`/api/comments/${id}`, { method: "DELETE" });
      expect(anonymous.status).toBe(401);

      const byAuthor = await commenter.fan.call(`/api/comments/${id}`, { method: "DELETE" });
      expect(byAuthor.status).toBe(204);
      expect(await prisma.comment.count({ where: { id: id! } })).toBe(0);
      expect(await commentCountOf(debateId)).toBe(0);

      const again = await commenter.fan.call(`/api/comments/${id}`, { method: "DELETE" });
      expect(again.status).toBe(404);
      const malformed = await commenter.fan.call("/api/comments/abc", { method: "DELETE" });
      expect(malformed.status).toBe(404);
    });

    test("a comment whose author is gone can't be deleted here", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);
      const [id] = await insertComments(debateId, author.userId, 1);
      await prisma.comment.update({ where: { id: id! }, data: { authorId: null } });

      const response = await author.fan.call(`/api/comments/${id}`, { method: "DELETE" });
      expect(response.status).toBe(403);
    });
  });

  describe("races and counters", () => {
    test("8 fans commenting at once give a count of 8 that matches the rows", async () => {
      const poster = await newFan(true);
      const debateId = await newDebate(poster.userId);

      const fans: TestFan[] = [];
      for (let i = 0; i < 8; i++) {
        fans.push(await newFan(true));
      }

      // start all 8 requests first, then wait for all of them together
      const requests = [];
      let number = 0;
      for (const f of fans) {
        requests.push(postComment(f.fan, debateId, { body: `Take number ${number}.` }));
        number = number + 1;
      }
      const responses = await Promise.all(requests);
      for (const response of responses) {
        expect(response.status).toBe(201);
      }

      expect(await prisma.comment.count({ where: { debateId: debateId } })).toBe(8);
      expect(await commentCountOf(debateId)).toBe(8);
    });

    test("the same fan firing the same body 5 times at once gets one 201 and four 409s", async () => {
      const author = await newFan(true);
      const debateId = await newDebate(author.userId);

      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(postComment(author.fan, debateId, { body: "Double tap." }));
      }
      const responses = await Promise.all(requests);
      const statuses: number[] = [];
      for (const response of responses) {
        statuses.push(response.status);
      }
      statuses.sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(await commentCountOf(debateId)).toBe(1);
    });
  });

  describe("account and debate deletion", () => {
    test("a commenter deleting their account leaves the comment as deleted user, still counted", async () => {
      const poster = await newFan(true);
      const commenter = await newFan(true);
      const debateId = await newDebate(poster.userId);
      const posted = await postComment(commenter.fan, debateId, { body: "I was here." });
      const commentId = Comment.parse(await posted.json()).id;

      const deleted = await commenter.fan.call("/api/auth/delete-user", { body: { password: commenter.password } });
      expect(deleted.status).toBe(200);

      const row = await prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
      expect(row.authorId).toBeNull();
      expect(await commentCountOf(debateId)).toBe(1);
      const page = await getPage(debateId, "");
      expect(page.items[0]?.author.displayName).toBe("deleted user");
    });

    test("deleting the debate removes its comments", async () => {
      const poster = await newFan(true);
      const debateId = await newDebate(poster.userId);
      await insertComments(debateId, poster.userId, 3);

      const response = await poster.fan.call(`/api/debates/${debateId}`, { method: "DELETE" });
      expect(response.status).toBe(204);
      expect(await prisma.comment.count({ where: { debateId: debateId } })).toBe(0);
    });
  });
});
