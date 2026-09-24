import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { prisma } from "@varroom/db/client";
import { seedTags } from "@varroom/db/seed";
import { Debate, ErrorResponse, ListDebatesResponse, ListTagsResponse } from "@varroom/shared";
import { getLastEmail } from "../auth/email.ts";
import { Fan, newFanDetails } from "../testing/fan.ts";
import { startTestServer } from "../testing/server.ts";

// Integration tests for the debates API (spec 0004). Like the sign in
// tests, they run against the Neon `test` branch (wiped and seeded with
// tags before every run) and are skipped without DATABASE_URL_TEST.
//
// Other tests post debates too, so every list test filters by its own
// fan (?author=...) to only see its own debates.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
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

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

type TestFan = {
  fan: Fan;
  userId: string;
  username: string;
  password: string;
};

// A signed in fan. confirmed: true also clicks the email link.
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
  return { fan: fan, userId: user.id, username: details.username, password: details.password };
}

// A valid debate body. Each call gets a different title, so no duplicates.
function debateBody(extra: Record<string, unknown> = {}) {
  const tag = crypto.randomUUID().slice(0, 8);
  return {
    title: `Bellingham is better as a 9 (${tag})`,
    thesis: "He arrives in the box late and wins more headers than any other midfielder.",
    categories: ["TACTICAL"],
    ...extra,
  };
}

async function postDebate(fan: Fan, body: unknown) {
  return fan.call("/api/debates", { body: body });
}

async function errorOf(response: Response) {
  return ErrorResponse.parse(await response.json()).error;
}

// Reads a list page and checks its shape.
async function getList(fan: Fan, query: string) {
  const response = await fan.call(`/api/debates?${query}`);
  expect(response.status).toBe(200);
  return ListDebatesResponse.parse(await response.json());
}

function idsOf(debates: { id: string }[]): string[] {
  const ids: string[] = [];
  for (const debate of debates) {
    ids.push(debate.id);
  }
  return ids;
}

// Saves debates straight into the database (no cap, no API).
// They are dated 2 days ago, a second apart, so they don't count towards
// the daily cap and the newest is the first in the list.
async function insertDebates(authorId: string, count: number): Promise<string[]> {
  const start = Date.now() - 2 * ONE_DAY_MS;
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const debate = await prisma.debate.create({
      data: {
        authorId: authorId,
        title: `Inserted debate number ${i}`,
        thesis: "A thesis long enough to pass the thirty character rule.",
        categories: ["OTHER"],
        createdAt: new Date(start - i * 1000),
      },
    });
    ids.push(debate.id);
  }
  return ids; // newest first
}

// A fetch with full control over the headers, for the origin and content type tests.
async function rawRequest(fan: Fan, method: string, path: string, headers: Record<string, string>, body?: string) {
  const allHeaders: Record<string, string> = { ...headers, Cookie: fan.cookieHeader() };
  return fetch(baseUrl + path, { method: method, headers: allHeaders, body: body });
}

// ---------------------------------------------------------------
// The tests
// ---------------------------------------------------------------

describe.skipIf(!hasTestDatabase)("debates API (spec 0004)", () => {
  describe("posting and reading (AC-1, AC-9)", () => {
    test("a confirmed fan posts a debate and reads it back in the same shape", async () => {
      const { fan, username } = await newFan(true);

      const response = await postDebate(fan, {
        title: "  Arsenal should\nsign a striker  ",
        thesis: "   They create plenty of chances but finish too few of them every season.   ",
        categories: ["transfer", "TACTICAL"],
        tags: ["arsenal", "premier-league"],
      });
      expect(response.status).toBe(201);
      const posted = Debate.parse(await response.json());

      expect(posted.title).toBe("Arsenal should sign a striker"); // trimmed, line break gone
      expect(posted.thesis).toBe("They create plenty of chances but finish too few of them every season.");
      expect(posted.categories).toEqual(["TRANSFER", "TACTICAL"]);
      // Leagues first, then teams.
      expect(posted.tags).toEqual([
        { slug: "premier-league", name: "Premier League", kind: "LEAGUE" },
        { slug: "arsenal", name: "Arsenal", kind: "TEAM" },
      ]);
      expect(posted.author.username).toBe(username);
      expect(posted.upVotes).toBe(0);
      expect(posted.downVotes).toBe(0);
      expect(posted.voteScore).toBe(0);
      expect(posted.commentCount).toBe(0);
      expect(posted.credibilityScore).toBeNull();
      expect(posted.latestReview).toBeNull();
      expect(posted.myVote).toBeNull();

      // It comes first in the New list...
      const list = await getList(fan, `sort=new&author=${username}`);
      expect(list.items[0]).toEqual(posted);

      // ...and reading it by id gives the same shape, even without a session.
      const stranger = new Fan(baseUrl);
      const read = await stranger.call(`/api/debates/${posted.id}`);
      expect(read.status).toBe(200);
      expect(Debate.parse(await read.json())).toEqual(posted);
    });

    test("the latest review and a deleted author are shown (AC-9)", async () => {
      const { fan, userId } = await newFan(true);
      const [id] = await insertDebates(userId, 1);

      await prisma.review.create({
        data: { debateId: id!, status: "COMPLETE", decision: "CONFIRMED", credibilityScore: 74, summary: "Holds up.", completedAt: new Date() },
      });
      await prisma.debate.update({ where: { id: id! }, data: { authorId: null } });

      const response = await fan.call(`/api/debates/${id}`);
      const debate = Debate.parse(await response.json());
      expect(debate.author).toEqual({ username: null, displayUsername: null, displayName: "deleted user", badge: null });
      expect(debate.latestReview?.status).toBe("COMPLETE");
      expect(debate.latestReview?.decision).toBe("CONFIRMED");
      expect(debate.latestReview?.credibilityScore).toBe(74);
    });

    test("an unknown or malformed id answers 404, never 500 (AC-9)", async () => {
      const fan = new Fan(baseUrl);
      const malformed = await fan.call("/api/debates/abc");
      expect(malformed.status).toBe(404);
      expect((await errorOf(malformed)).code).toBe("NOT_FOUND");

      const unknown = await fan.call(`/api/debates/${crypto.randomUUID()}`);
      expect(unknown.status).toBe(404);
    });
  });

  describe("validation (AC-2, AC-14)", () => {
    // Each bad body, and the field path the error must name.
    const cases: { name: string; body: Record<string, unknown>; path: string }[] = [
      { name: "a 9 character title", body: debateBody({ title: "Too short" }), path: "title" },
      { name: "a thesis of only spaces", body: debateBody({ thesis: "                                        " }), path: "thesis" },
      { name: "5 categories", body: debateBody({ categories: ["TACTICAL", "TRANSFER", "PLAYER", "OTHER", "FUN"] }), path: "categories" },
      { name: "no categories", body: debateBody({ categories: [] }), path: "categories" },
      { name: "an unknown category", body: debateBody({ categories: ["GOSSIP"] }), path: "categories.0" },
      {
        name: "6 tags",
        body: debateBody({ tags: ["arsenal", "chelsea", "liverpool", "everton", "fulham", "brentford"] }),
        path: "tags",
      },
      { name: "an unknown tag slug", body: debateBody({ tags: ["arsenal", "not-a-club"] }), path: "tags.1" },
      { name: "a missing title", body: { thesis: "A thesis long enough to pass the rule.", categories: ["OTHER"] }, path: "title" },
    ];

    for (const testCase of cases) {
      test(`${testCase.name} answers 400 naming "${testCase.path}"`, async () => {
        const { fan } = await newFan(true);
        const response = await postDebate(fan, testCase.body);
        expect(response.status).toBe(400);

        const error = await errorOf(response);
        expect(error.code).toBe("VALIDATION_FAILED");
        // The error must name the field (or an item in it, like "categories.4").
        expect(hasPathStartingWith(error.fields, testCase.path)).toBe(true);
      });
    }

    test("repeats are removed before counting, slugs are lowercased, extra fields are ignored", async () => {
      const { fan } = await newFan(true);
      const response = await postDebate(
        fan,
        debateBody({
          categories: ["TACTICAL", "tactical", "PLAYER", "PLAYER", "OTHER", "TRANSFER"],
          tags: ["Arsenal", " arsenal ", "CHELSEA"],
          focusPlayerId: 12345,
        }),
      );
      expect(response.status).toBe(201);
      const debate = Debate.parse(await response.json());
      expect(debate.categories).toEqual(["TACTICAL", "PLAYER", "OTHER", "TRANSFER"]);
      expect(idsOfSlugs(debate.tags)).toEqual(["arsenal", "chelsea"]);

      const saved = await prisma.debate.findUniqueOrThrow({ where: { id: debate.id } });
      expect(saved.focusPlayerId).toBeNull();
    });
  });

  describe("who may post (AC-3)", () => {
    test("no session answers 401", async () => {
      const stranger = new Fan(baseUrl);
      const response = await postDebate(stranger, debateBody());
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe("UNAUTHENTICATED");
    });

    test("an unconfirmed email answers 403 EMAIL_NOT_VERIFIED", async () => {
      const { fan } = await newFan(false);
      const response = await postDebate(fan, debateBody());
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe("EMAIL_NOT_VERIFIED");
    });

    test("another website's origin answers 403 BAD_ORIGIN, even with broken JSON", async () => {
      const { fan } = await newFan(true);
      const evil = { Origin: "https://evil.example", "Content-Type": "application/json" };

      const valid = await rawRequest(fan, "POST", "/api/debates", evil, JSON.stringify(debateBody()));
      expect(valid.status).toBe(403);
      expect((await errorOf(valid)).code).toBe("BAD_ORIGIN");

      const broken = await rawRequest(fan, "POST", "/api/debates", evil, "{not json");
      expect(broken.status).toBe(403);
      expect((await errorOf(broken)).code).toBe("BAD_ORIGIN");

      const noOrigin = await rawRequest(fan, "POST", "/api/debates", { "Content-Type": "application/json" }, "{}");
      expect(noOrigin.status).toBe(403);
    });

    test("a body that is not JSON answers 415, broken JSON answers 400 INVALID_JSON", async () => {
      const { fan } = await newFan(true);

      const text = await rawRequest(fan, "POST", "/api/debates", { Origin: baseUrl, "Content-Type": "text/plain" }, "hello");
      expect(text.status).toBe(415);
      expect((await errorOf(text)).code).toBe("UNSUPPORTED_MEDIA_TYPE");

      const broken = await rawRequest(fan, "POST", "/api/debates", { Origin: baseUrl, "Content-Type": "application/json" }, "{not json");
      expect(broken.status).toBe(400);
      expect((await errorOf(broken)).code).toBe("INVALID_JSON");
    });
  });

  describe("daily cap and duplicates (AC-4, AC-5)", () => {
    test("the 6th post in 24 hours answers 429 and saves nothing; a repeat answers 409 even at the cap", async () => {
      const { fan, userId } = await newFan(true);

      const firstBody = debateBody();
      const first = await postDebate(fan, firstBody);
      expect(first.status).toBe(201);
      const firstId = Debate.parse(await first.json()).id;

      for (let i = 0; i < 4; i++) {
        const response = await postDebate(fan, debateBody());
        expect(response.status).toBe(201);
      }

      const sixth = await postDebate(fan, debateBody());
      expect(sixth.status).toBe(429);
      expect((await errorOf(sixth)).code).toBe("POST_LIMIT_REACHED");
      expect(await prisma.debate.count({ where: { authorId: userId } })).toBe(5);

      // The same title and thesis again, with extra spaces: the duplicate wins over the cap.
      const repeat = await postDebate(fan, {
        ...firstBody,
        title: `   ${firstBody.title}   `,
        thesis: `  ${firstBody.thesis}  `,
      });
      expect(repeat.status).toBe(409);
      const error = await errorOf(repeat);
      expect(error.code).toBe("DUPLICATE_DEBATE");
      expect(error.existingId).toBe(firstId);
      expect(await prisma.debate.count({ where: { authorId: userId } })).toBe(5);
    });
  });

  describe("listing (AC-6 to AC-8, AC-10)", () => {
    test("New pages through 25 debates with no repeats, even when a new one is posted in between", async () => {
      const { fan, userId, username } = await newFan(true);
      const inserted = await insertDebates(userId, 25);

      const page1 = await getList(fan, `author=${username}&limit=10`);
      expect(idsOf(page1.items)).toEqual(inserted.slice(0, 10));
      expect(page1.nextCursor).not.toBeNull();

      // A new debate appears at the top, but page 2 carries on after page 1.
      const posted = await postDebate(fan, debateBody());
      expect(posted.status).toBe(201);

      const page2 = await getList(fan, `author=${username}&limit=10&cursor=${page1.nextCursor}`);
      const page3 = await getList(fan, `author=${username}&limit=10&cursor=${page2.nextCursor}`);
      expect(page3.nextCursor).toBeNull();

      const seen = [...idsOf(page1.items), ...idsOf(page2.items), ...idsOf(page3.items)];
      expect(seen).toEqual(inserted);
    });

    test("the default page size is 20", async () => {
      const { fan, userId, username } = await newFan(true);
      await insertDebates(userId, 21);
      const page = await getList(fan, `author=${username}`);
      expect(page.items.length).toBe(20);
      expect(page.nextCursor).not.toBeNull();
    });

    test("Top orders by votes, then credibility (unreviewed below 0), then newest, across pages", async () => {
      const { fan, userId, username } = await newFan(true);
      const ids = await insertDebates(userId, 6);

      // [voteScore, credibilityScore] for each inserted debate.
      const scores: [number, number | null][] = [
        [5, 10], // ids[0]
        [5, 80], // ids[1]
        [5, null], // ids[2]
        [5, 0], // ids[3]
        [7, null], // ids[4]
        [-1, 100], // ids[5]
      ];
      for (let i = 0; i < scores.length; i++) {
        const [voteScore, credibilityScore] = scores[i]!;
        await prisma.debate.update({ where: { id: ids[i]! }, data: { voteScore: voteScore, credibilityScore: credibilityScore } });
      }

      const page1 = await getList(fan, `sort=top&author=${username}&limit=2`);
      const page2 = await getList(fan, `sort=top&author=${username}&limit=2&cursor=${page1.nextCursor}`);
      const page3 = await getList(fan, `sort=TOP&author=${username}&limit=2&cursor=${page2.nextCursor}`);
      expect(page3.nextCursor).toBeNull();

      const order = [...idsOf(page1.items), ...idsOf(page2.items), ...idsOf(page3.items)];
      const expected = [ids[4]!, ids[1]!, ids[0]!, ids[3]!, ids[2]!, ids[5]!];
      expect(order).toEqual(expected);
    });

    test("category, tag and author filters combine with AND; unknown ones give an empty list", async () => {
      const { fan, username } = await newFan(true);

      const match = await postDebate(fan, debateBody({ categories: ["TRANSFER"], tags: ["arsenal"] }));
      await postDebate(fan, debateBody({ categories: ["TRANSFER"] }));
      await postDebate(fan, debateBody({ categories: ["TACTICAL"], tags: ["arsenal"] }));
      const matchId = Debate.parse(await match.json()).id;

      // The username in capitals still matches.
      const filtered = await getList(fan, `category=transfer&tag=arsenal&author=${username.toUpperCase()}`);
      expect(idsOf(filtered.items)).toEqual([matchId]);

      const noTag = await getList(fan, "tag=nope");
      expect(noTag.items).toEqual([]);
      const noAuthor = await getList(fan, "author=nobody_here_at_all");
      expect(noAuthor.items).toEqual([]);
    });

    test("a bad sort, limit or category answers 400 VALIDATION_FAILED", async () => {
      const fan = new Fan(baseUrl);
      const queries = ["sort=hot", "limit=500", "limit=0", "limit=abc", "category=gossip"];
      for (const query of queries) {
        const response = await fan.call(`/api/debates?${query}`);
        expect(response.status).toBe(400);
        expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
      }
    });

    test("a cursor that is not an id, or points at a deleted debate, answers 400 INVALID_CURSOR (AC-8)", async () => {
      const { fan, userId, username } = await newFan(true);
      await insertDebates(userId, 3);

      const page1 = await getList(fan, `author=${username}&limit=1`);
      await prisma.debate.delete({ where: { id: page1.nextCursor! } });

      const stale = await fan.call(`/api/debates?author=${username}&limit=1&cursor=${page1.nextCursor}`);
      expect(stale.status).toBe(400);
      expect((await errorOf(stale)).code).toBe("INVALID_CURSOR");

      const notAnId = await fan.call("/api/debates?cursor=abc");
      expect(notAnId.status).toBe(400);
      expect((await errorOf(notAnId)).code).toBe("INVALID_CURSOR");
    });

    test("myVote shows the viewer's own vote, and null without a session (AC-10)", async () => {
      const { userId } = await newFan(true);
      const [id] = await insertDebates(userId, 1);
      const voter = await newFan(true);
      await prisma.debateVote.create({ data: { debateId: id!, userId: voter.userId, value: 1 } });

      const asVoter = await voter.fan.call(`/api/debates/${id}`);
      expect(Debate.parse(await asVoter.json()).myVote).toBe(1);

      const anonymous = await new Fan(baseUrl).call(`/api/debates/${id}`);
      expect(Debate.parse(await anonymous.json()).myVote).toBeNull();
    });
  });

  describe("deleting (AC-11)", () => {
    test("only the author can delete, and everything attached goes with it", async () => {
      const author = await newFan(true);
      const other = await newFan(true);

      const posted = await postDebate(author.fan, debateBody({ tags: ["arsenal"] }));
      const id = Debate.parse(await posted.json()).id;
      await prisma.debateVote.create({ data: { debateId: id, userId: other.userId, value: -1 } });
      await prisma.comment.create({ data: { debateId: id, authorId: other.userId, body: "Nonsense." } });
      await prisma.review.create({ data: { debateId: id } });

      const byOther = await other.fan.call(`/api/debates/${id}`, { method: "DELETE" });
      expect(byOther.status).toBe(403);
      expect((await errorOf(byOther)).code).toBe("FORBIDDEN");

      const noSession = await new Fan(baseUrl).call(`/api/debates/${id}`, { method: "DELETE" });
      expect(noSession.status).toBe(401);

      const byAuthor = await author.fan.call(`/api/debates/${id}`, { method: "DELETE" });
      expect(byAuthor.status).toBe(204);

      expect(await prisma.debate.count({ where: { id: id } })).toBe(0);
      expect(await prisma.debateTag.count({ where: { debateId: id } })).toBe(0);
      expect(await prisma.debateVote.count({ where: { debateId: id } })).toBe(0);
      expect(await prisma.comment.count({ where: { debateId: id } })).toBe(0);
      expect(await prisma.review.count({ where: { debateId: id } })).toBe(0);

      const again = await author.fan.call(`/api/debates/${id}`, { method: "DELETE" });
      expect(again.status).toBe(404);
    });

    test("a malformed id answers 404, a bad origin answers 403 BAD_ORIGIN", async () => {
      const { fan } = await newFan(true);
      const malformed = await fan.call("/api/debates/abc", { method: "DELETE" });
      expect(malformed.status).toBe(404);

      const evil = await rawRequest(fan, "DELETE", `/api/debates/${crypto.randomUUID()}`, { Origin: "https://evil.example" });
      expect(evil.status).toBe(403);
      expect((await errorOf(evil)).code).toBe("BAD_ORIGIN");
    });

    test("a debate whose author is gone can't be deleted here", async () => {
      const { fan, userId } = await newFan(true);
      const [id] = await insertDebates(userId, 1);
      await prisma.debate.update({ where: { id: id! }, data: { authorId: null } });

      const response = await fan.call(`/api/debates/${id}`, { method: "DELETE" });
      expect(response.status).toBe(403);
    });
  });

  describe("account deletion keeps votes and comments (AC-13)", () => {
    test("the rows stay with a null user", async () => {
      const { userId } = await newFan(true);
      const [id] = await insertDebates(userId, 1);
      const voter = await newFan(true);
      const vote = await prisma.debateVote.create({ data: { debateId: id!, userId: voter.userId, value: 1 } });
      const comment = await prisma.comment.create({ data: { debateId: id!, authorId: voter.userId, body: "Agreed." } });

      const deleted = await voter.fan.call("/api/auth/delete-user", { body: { password: voter.password } });
      expect(deleted.status).toBe(200);

      const voteAfter = await prisma.debateVote.findUniqueOrThrow({ where: { id: vote.id } });
      const commentAfter = await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } });
      expect(voteAfter.userId).toBeNull();
      expect(commentAfter.authorId).toBeNull();
    });

    test("the database refuses a vote that is not 1 or -1", async () => {
      const { userId } = await newFan(true);
      const [id] = await insertDebates(userId, 1);
      let failed = false;
      try {
        await prisma.debateVote.create({ data: { debateId: id!, userId: userId, value: 5 } });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    });
  });

  describe("tags (AC-12)", () => {
    test("GET /api/tags lists leagues first, then teams, and filters by kind", async () => {
      const fan = new Fan(baseUrl);

      const all = ListTagsResponse.parse(await (await fan.call("/api/tags")).json());
      expect(all.items.length).toBe(151);
      expect(all.items[0]).toEqual({ slug: "bundesliga", name: "Bundesliga", kind: "LEAGUE" });

      const leagues = ListTagsResponse.parse(await (await fan.call("/api/tags?kind=LEAGUE")).json());
      expect(leagues.items.length).toBe(7);

      const teams = ListTagsResponse.parse(await (await fan.call("/api/tags?kind=team")).json());
      expect(teams.items.length).toBe(144);
      expect(teams.items[0]?.name).toBe("AC Milan");

      const bad = await fan.call("/api/tags?kind=club");
      expect(bad.status).toBe(400);
    });

    test("running the seed twice changes nothing", async () => {
      const before = await prisma.tag.count();
      await seedTags();
      await seedTags();
      expect(await prisma.tag.count()).toBe(before);
    });
  });
});

// Small helpers used above, kept at the bottom so the tests read first.
function hasPathStartingWith(fields: { path: string }[] | undefined, path: string): boolean {
  if (!fields) {
    return false;
  }
  for (const field of fields) {
    if (field.path === path || field.path.startsWith(path + ".")) {
      return true;
    }
  }
  return false;
}

function idsOfSlugs(tags: { slug: string }[]): string[] {
  const slugs: string[] = [];
  for (const tag of tags) {
    slugs.push(tag.slug);
  }
  return slugs;
}
