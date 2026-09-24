import { prisma } from "./client.ts";
import { listNewDebateIds, listTopDebateIds } from "./generated/prisma/sql.ts";

// db access for debates. the api goes through these, never prisma directly

export type DebateCategoryValue = "TACTICAL" | "TRANSFER" | "PLAYER" | "OTHER";

// posting

// same author + exact same title/thesis after `since` -> its id, else null
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

// debates by this author after `since`, for the daily cap
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

// creates debate + tag links in one nested create (single transaction).
// the review api will add the QUEUED review here later
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

// reading

// full debates with author, tags and newest review. result order is not the ids order
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

// row type from getDebatesByIds
export type DebateRow = Awaited<ReturnType<typeof getDebatesByIds>>[number];

// debateId -> vote value for this user. no entry = no vote
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

// used to validate the list cursor
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

// one page of ordered ids from the typedsql files in prisma/sql.
// caller passes limit + 1 to detect a next page
export async function listDebateIds(options: ListDebateIdsOptions): Promise<string[]> {
  // typedsql needs null, not undefined, for optional params
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

// deleting

// found: false = no such debate. authorId null = author deleted their account
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

// tags/votes/comments/reviews go with it via cascade.
// deleteMany so a concurrent delete doesn't throw
export async function deleteDebate(id: string): Promise<void> {
  await prisma.debate.deleteMany({
    where: { id: id },
  });
}
