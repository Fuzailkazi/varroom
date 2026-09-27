import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { prisma } from "@varroom/db/client";
import { Debate, ErrorResponse, ListDebatesResponse } from "@varroom/shared";
import { getLastEmail } from "../auth/email.ts";
import { Fan, newFanDetails } from "../testing/fan.ts";
import { startTestServer } from "../testing/server.ts";

// integration tests for PUT /api/debates/:id/vote. runs against the neon
// test branch (reset before each run), skipped without DATABASE_URL_TEST.

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

type TestFan = {
  fan: Fan;
  userId: string;
  username: string;
};

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
  return { fan: fan, userId: user.id, username: details.username };
}

async function insertDebate(authorId: string | null): Promise<string> {
  const debate = await prisma.debate.create({
    data: {
      authorId: authorId,
      title: "Inserted debate for vote tests",
      thesis: "A thesis long enough to pass the thirty character rule.",
      categories: ["OTHER"],
    },
    select: { id: true },
  });
  return debate.id;
}

async function vote(fan: Fan, debateId: string, value: number) {
  return fan.call(`/api/debates/${debateId}/vote`, { method: "PUT", body: { value: value } });
}

async function errorOf(response: Response) {
  return ErrorResponse.parse(await response.json()).error;
}

async function rawRequest(fan: Fan, method: string, path: string, headers: Record<string, string>, body?: string) {
  const allHeaders: Record<string, string> = { ...headers, Cookie: fan.cookieHeader() };
  return fetch(baseUrl + path, { method: method, headers: allHeaders, body: body });
}

async function countedRow(debateId: string) {
  return prisma.debate.findUniqueOrThrow({
    where: { id: debateId },
    select: { upVotes: true, downVotes: true, voteScore: true },
  });
}

describe.skipIf(!hasTestDatabase)("PUT /api/debates/:id/vote", () => {
  test("up, then down, then down again removes it, and a fresh read agrees", async () => {
    const { fan, userId } = await newFan(true);
    const debateId = await insertDebate(userId);

    const up = await vote(fan, debateId, 1);
    expect(up.status).toBe(200);
    let body = Debate.parse(await up.json());
    expect(body.upVotes).toBe(1);
    expect(body.downVotes).toBe(0);
    expect(body.voteScore).toBe(1);
    expect(body.myVote).toBe(1);

    const down = await vote(fan, debateId, -1);
    body = Debate.parse(await down.json());
    expect(body.upVotes).toBe(0);
    expect(body.downVotes).toBe(1);
    expect(body.voteScore).toBe(-1);
    expect(body.myVote).toBe(-1);

    const downAgain = await vote(fan, debateId, -1);
    body = Debate.parse(await downAgain.json());
    expect(body.downVotes).toBe(0);
    expect(body.voteScore).toBe(0);
    expect(body.myVote).toBeNull();

    const read = await fan.call(`/api/debates/${debateId}`);
    expect(Debate.parse(await read.json())).toEqual(body);
  });

  test("6 simultaneous votes from the same fan settle to one row or none, matching the counters", async () => {
    const { fan, userId } = await newFan(true);
    const debateId = await insertDebate(userId);

    await Promise.all([1, -1, 1, -1, 1, -1].map((value) => vote(fan, debateId, value)));

    const rows = await prisma.debateVote.count({ where: { debateId: debateId, userId: userId } });
    expect(rows).toBeLessThanOrEqual(1);

    const counted = await countedRow(debateId);
    const freshUp = await prisma.debateVote.count({ where: { debateId: debateId, value: 1 } });
    const freshDown = await prisma.debateVote.count({ where: { debateId: debateId, value: -1 } });
    expect(counted.upVotes).toBe(freshUp);
    expect(counted.downVotes).toBe(freshDown);
    expect(counted.voteScore).toBe(freshUp - freshDown);
  });

  test("8 fans voting at once (5 up, 3 down) leave counters that match a fresh count", async () => {
    const { userId } = await newFan(true);
    const debateId = await insertDebate(userId);

    const values = [1, 1, 1, 1, 1, -1, -1, -1];
    const fans = await Promise.all(values.map(() => newFan(true)));

    await Promise.all(fans.map((f, index) => vote(f.fan, debateId, values[index]!)));

    const counted = await countedRow(debateId);
    expect(counted.upVotes).toBe(5);
    expect(counted.downVotes).toBe(3);
    expect(counted.voteScore).toBe(2);

    const freshUp = await prisma.debateVote.count({ where: { debateId: debateId, value: 1 } });
    const freshDown = await prisma.debateVote.count({ where: { debateId: debateId, value: -1 } });
    expect(counted.upVotes).toBe(freshUp);
    expect(counted.downVotes).toBe(freshDown);
  });

  test("bad value, or 0, or missing answers 400 with a fields entry for value", async () => {
    const { fan, userId } = await newFan(true);
    const debateId = await insertDebate(userId);

    for (const value of [0, 2, "up", undefined]) {
      const body: Record<string, unknown> = value === undefined ? {} : { value: value };
      const response = await fan.call(`/api/debates/${debateId}/vote`, { method: "PUT", body: body });
      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.fields?.[0]?.path).toBe("value");
    }
  });

  test("no session answers 401, an unconfirmed email answers 403 EMAIL_NOT_VERIFIED", async () => {
    const { userId } = await newFan(true);
    const debateId = await insertDebate(userId);

    const anon = new Fan(baseUrl);
    const anonResponse = await vote(anon, debateId, 1);
    expect(anonResponse.status).toBe(401);
    expect((await errorOf(anonResponse)).code).toBe("UNAUTHENTICATED");

    const { fan: unconfirmed } = await newFan(false);
    const unconfirmedResponse = await vote(unconfirmed, debateId, 1);
    expect(unconfirmedResponse.status).toBe(403);
    expect((await errorOf(unconfirmedResponse)).code).toBe("EMAIL_NOT_VERIFIED");
  });

  test("a malformed or unknown debate id answers 404 with no row written", async () => {
    const { fan } = await newFan(true);

    const malformed = await vote(fan, "abc", 1);
    expect(malformed.status).toBe(404);
    expect((await errorOf(malformed)).code).toBe("NOT_FOUND");

    const unknownId = crypto.randomUUID();
    const unknown = await vote(fan, unknownId, 1);
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe("NOT_FOUND");

    const rows = await prisma.debateVote.count({ where: { debateId: unknownId } });
    expect(rows).toBe(0);
  });

  test("precedence: bad origin beats a bad value, a malformed id beats a bad value, a missing debate beats a bad value", async () => {
    const { fan } = await newFan(true);
    const evilOrigin = { Origin: "https://evil.example", "Content-Type": "application/json" };
    const goodOrigin = { Origin: baseUrl, "Content-Type": "application/json" };

    const badOrigin = await rawRequest(fan, "PUT", `/api/debates/${crypto.randomUUID()}/vote`, evilOrigin, JSON.stringify({ value: 0 }));
    expect(badOrigin.status).toBe(403);
    expect((await errorOf(badOrigin)).code).toBe("BAD_ORIGIN");

    const malformedId = await rawRequest(fan, "PUT", "/api/debates/not-a-uuid/vote", goodOrigin, JSON.stringify({ value: 0 }));
    expect(malformedId.status).toBe(404);

    const missingDebate = await rawRequest(fan, "PUT", `/api/debates/${crypto.randomUUID()}/vote`, goodOrigin, JSON.stringify({ value: 0 }));
    expect(missingDebate.status).toBe(400);
    expect((await errorOf(missingDebate)).code).toBe("VALIDATION_FAILED");
  });

  test("the author may vote on their own debate, and a debate whose author is gone can still be voted on", async () => {
    const { fan, userId } = await newFan(true);
    const debateId = await insertDebate(userId);

    const ownVote = await vote(fan, debateId, 1);
    expect(ownVote.status).toBe(200);

    await prisma.debate.update({ where: { id: debateId }, data: { authorId: null } });
    const { fan: stranger } = await newFan(true);
    const strangerVote = await vote(stranger, debateId, 1);
    expect(strangerVote.status).toBe(200);
  });

  test("sort=top orders by the new vote_score, and an anonymous list shows myVote null", async () => {
    const { userId } = await newFan(true);
    const [highId, midId, lowId] = await Promise.all([insertDebate(userId), insertDebate(userId), insertDebate(userId)]);

    const upvoters = await Promise.all([newFan(true), newFan(true)]);
    await vote(upvoters[0]!.fan, highId!, 1);
    await vote(upvoters[1]!.fan, highId!, 1);
    const downvoter = await newFan(true);
    await vote(downvoter.fan, lowId!, -1);

    const stranger = new Fan(baseUrl);
    const author = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });
    const response = await stranger.call(`/api/debates?sort=top&author=${author.username}`);
    expect(response.status).toBe(200);
    const body = ListDebatesResponse.parse(await response.json());
    const ids = body.items.map((d) => d.id);
    expect(ids.indexOf(highId!)).toBeLessThan(ids.indexOf(midId!));
    expect(ids.indexOf(midId!)).toBeLessThan(ids.indexOf(lowId!));
    for (const item of body.items) {
      expect(item.myVote).toBeNull();
    }
  });

  test("a voter deleting their account keeps their vote counted, and deleting a debate removes its votes", async () => {
    const { userId } = await newFan(true);
    const debateId = await insertDebate(userId);
    const { fan: voter, userId: voterId } = await newFan(true);

    await vote(voter, debateId, 1);
    await prisma.user.delete({ where: { id: voterId } });

    const counted = await countedRow(debateId);
    expect(counted.upVotes).toBe(1);
    const row = await prisma.debateVote.findFirst({ where: { debateId: debateId } });
    expect(row?.userId).toBeNull();

    await prisma.debate.delete({ where: { id: debateId } });
    const remainingVotes = await prisma.debateVote.count({ where: { debateId: debateId } });
    expect(remainingVotes).toBe(0);
  });
});
