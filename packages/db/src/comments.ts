import { prisma } from "./client.ts";
import type { Prisma } from "./generated/prisma/client.ts";

// db access for comments. the api goes through these, never prisma directly.
// every write locks the debate row first and recounts comment_count in the same
// transaction, same pattern as votes, so the counter always equals the rows

const DUPLICATE_WINDOW_MS = 60 * 1000;

// fans commenting on the same debate at once wait in line for the debate lock.
// each turn is a few round trips to neon, so the last one in a busy line can
// pass prisma's 5 second default and get cancelled. give it more room
const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 15000 };

// a comment row plus the author fields the api shows
export type CommentRow = {
  id: string;
  debateId: string;
  authorId: string | null; // null = author deleted their account
  body: string;
  createdAt: Date;
  author: {
    username: string | null;
    displayUsername: string | null;
    name: string;
    badge: "SPECTATOR" | "ASSISTANT_REF" | "CHIEF_VAR";
  } | null;
};

// which author fields to load with each comment
const authorFields = {
  select: { username: true, displayUsername: true, name: true, badge: true },
};

// locks the debate row until the transaction ends, so other writers on this
// debate wait their turn. returns false if the debate doesn't exist
async function lockDebate(tx: Prisma.TransactionClient, debateId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM debates WHERE id = ${debateId}::uuid FOR UPDATE
  `;
  return rows.length > 0;
}

// sets comment_count from a fresh count. only call it after lockDebate
async function recountComments(tx: Prisma.TransactionClient, debateId: string): Promise<void> {
  const count = await tx.comment.count({ where: { debateId: debateId } });
  await tx.debate.update({
    where: { id: debateId },
    data: { commentCount: count },
  });
}

// creating

export type CreateCommentResult = {
  outcome: "created" | "duplicate" | "debate_not_found";
  comment: CommentRow | null; // set when outcome is "created"
  existingId: string | null; // set when outcome is "duplicate"
};

export async function createComment(debateId: string, authorId: string, body: string): Promise<CreateCommentResult> {
  return prisma.$transaction(async (tx) => {
    const debateFound = await lockDebate(tx, debateId);
    if (!debateFound) {
      return { outcome: "debate_not_found", comment: null, existingId: null };
    }

    // same fan, same text, same debate, in the last minute = a double tap
    const oneMinuteAgo = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const duplicate = await tx.comment.findFirst({
      where: {
        debateId: debateId,
        authorId: authorId,
        body: body,
        createdAt: { gt: oneMinuteAgo },
      },
      select: { id: true },
    });
    if (duplicate) {
      return { outcome: "duplicate", comment: null, existingId: duplicate.id };
    }

    const comment = await tx.comment.create({
      data: { debateId: debateId, authorId: authorId, body: body },
      include: { author: authorFields },
    });
    await recountComments(tx, debateId);

    return { outcome: "created", comment: comment, existingId: null };
  }, TRANSACTION_OPTIONS);
}

// reading

// one page of comments, newest first. the caller asks for limit + 1 rows to
// find out if there's a next page.
// with a cursor, prisma starts right after that comment in the same order,
// so pages never repeat or skip
export async function listComments(debateId: string, limit: number, cursorId: string | undefined): Promise<CommentRow[]> {
  if (cursorId === undefined) {
    return prisma.comment.findMany({
      where: { debateId: debateId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { author: authorFields },
    });
  }

  return prisma.comment.findMany({
    where: { debateId: debateId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    cursor: { id: cursorId },
    skip: 1, // skip the cursor comment itself, it was on the last page
    include: { author: authorFields },
  });
}

// a list cursor must be a comment of this same debate
export async function commentBelongsToDebate(commentId: string, debateId: string): Promise<boolean> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { debateId: true },
  });
  if (!comment) {
    return false;
  }
  return comment.debateId === debateId;
}

// deleting

// who wrote the comment and which debate it's on, or null if there's no such comment
export async function getCommentForDelete(id: string): Promise<{ authorId: string | null; debateId: string } | null> {
  const comment = await prisma.comment.findUnique({
    where: { id: id },
    select: { authorId: true, debateId: true },
  });
  return comment;
}

// deletes the comment and recounts its debate. if the debate was deleted in
// the meantime (which already removed the comment) there's nothing left to do
export async function deleteComment(id: string, debateId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const debateFound = await lockDebate(tx, debateId);
    if (!debateFound) {
      return;
    }
    // deleteMany doesn't throw if the comment is already gone
    await tx.comment.deleteMany({ where: { id: id } });
    await recountComments(tx, debateId);
  }, TRANSACTION_OPTIONS);
}
