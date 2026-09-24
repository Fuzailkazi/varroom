import { prisma } from "./client.ts";
import { listNewDebateIds, listTopDebateIds } from "./generated/prisma/sql.ts";

// Database functions for the debates API (spec 0004).
// The API never talks to Prisma directly for debates; it calls these.

export type DebateCategoryValue = "TACTICAL" | "TRANSFER" | "PLAYER" | "OTHER";

// ---------------------------------------------------------------
// Posting (AC-1, AC-4, AC-5)
// ---------------------------------------------------------------

// A debate by the same fan, with the exact same title and thesis,
// posted after `since`. Returns its id, or null if there is none.
export async function findRecentDuplicate(
  authorId: string,
  title: string,
  thesis: string,
  since: Date,
): Promise<string | null> {
  const duplicate = await prisma.debate.findFirst({
    where: {
      authorId: authorId,
      title: title,
      thesis: thesis,
      createdAt: { gt: since },
    },
    select: { id: true },
  });

  if (!duplicate) {
    return null;
  }
  return duplicate.id;
}

// How many debates this fan posted after `since` (the daily cap).
export function countDebatesSince(authorId: string, since: Date): Promise<number> {
  return prisma.debate.count({
    where: {
      authorId: authorId,
      createdAt: { gt: since },
    },
  });
}

export type NewDebate = {
  authorId: string;
  title: string;
  thesis: string;
  categories: DebateCategoryValue[];
  tagIds: number[];
};

// Saves the debate and its tag links together. A "nested create" runs as
// one transaction: either everything is saved, or nothing is.
// Feature 25 will add the QUEUED review to this same create.
export async function createDebate(debate: NewDebate): Promise<string> {
  const tagLinks = [];
  for (const tagId of debate.tagIds) {
    tagLinks.push({ tagId: tagId });
  }

  const created = await prisma.debate.create({
    data: {
      authorId: debate.authorId,
      title: debate.title,
      thesis: debate.thesis,
      categories: debate.categories,
      tags: { create: tagLinks },
    },
    select: { id: true },
  });
  return created.id;
}

// ---------------------------------------------------------------
// Reading (AC-6, AC-9, AC-10)
// ---------------------------------------------------------------

// The full debates for these ids, with everything a response needs:
// the author, the tags, and the newest review (any status).
// The order of the result is NOT the order of `ids`; the caller fixes that.
export function getDebatesByIds(ids: string[]) {
  return prisma.debate.findMany({
    where: { id: { in: ids } },
    include: {
      author: {
        select: { username: true, displayUsername: true, name: true, badge: true },
      },
      tags: {
        include: { tag: true },
      },
      reviews: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          status: true,
          decision: true,
          credibilityScore: true,
          summary: true,
          createdAt: true,
          completedAt: true,
        },
      },
    },
  });
}

// One debate as getDebatesByIds returns it.
export type DebateRow = Awaited<ReturnType<typeof getDebatesByIds>>[number];

// The viewer's votes on these debates: debate id -> 1 or -1.
// Debates they did not vote on are not in the map.
export async function getVotesForUser(userId: string, debateIds: string[]): Promise<Map<string, number>> {
  const votes = await prisma.debateVote.findMany({
    where: {
      userId: userId,
      debateId: { in: debateIds },
    },
    select: { debateId: true, value: true },
  });

  const byDebate = new Map<string, number>();
  for (const vote of votes) {
    byDebate.set(vote.debateId, vote.value);
  }
  return byDebate;
}

// Does a debate with this id exist? Used to check a list cursor (AC-8).
export async function debateExists(id: string): Promise<boolean> {
  const found = await prisma.debate.findUnique({
    where: { id: id },
    select: { id: true },
  });
  return found !== null;
}

export type ListDebateIdsOptions = {
  sort: "new" | "top";
  limit: number;
  cursorId?: string | undefined;
  category?: DebateCategoryValue | undefined;
  tag?: string | undefined;
  author?: string | undefined;
};

// One page of debate ids, in the right order, from the TypedSQL files in
// prisma/sql. We ask for `limit` rows; the caller asks for one extra to
// find out if there is a next page.
export async function listDebateIds(options: ListDebateIdsOptions): Promise<string[]> {
  // TypedSQL wants null (not undefined) for a param that is not set.
  const category = options.category ?? null;
  const tag = options.tag ?? null;
  const author = options.author ?? null;
  const cursorId = options.cursorId ?? null;

  let rows: { id: string }[];
  if (options.sort === "top") {
    rows = await prisma.$queryRawTyped(listTopDebateIds(category, tag, author, cursorId, options.limit));
  } else {
    rows = await prisma.$queryRawTyped(listNewDebateIds(category, tag, author, cursorId, options.limit));
  }

  const ids: string[] = [];
  for (const row of rows) {
    ids.push(row.id);
  }
  return ids;
}

// ---------------------------------------------------------------
// Deleting (AC-11)
// ---------------------------------------------------------------

// Who wrote the debate. `found: false` means no such debate.
// authorId is null when the author deleted their account.
export async function getDebateAuthor(id: string): Promise<{ found: boolean; authorId: string | null }> {
  const debate = await prisma.debate.findUnique({
    where: { id: id },
    select: { authorId: true },
  });

  if (!debate) {
    return { found: false, authorId: null };
  }
  return { found: true, authorId: debate.authorId };
}

// Deletes the debate. The database removes its tags, votes, comments and
// reviews with it (ON DELETE CASCADE). deleteMany does not throw when the
// row is already gone (another request deleted it a moment ago).
export async function deleteDebate(id: string): Promise<void> {
  await prisma.debate.deleteMany({
    where: { id: id },
  });
}
