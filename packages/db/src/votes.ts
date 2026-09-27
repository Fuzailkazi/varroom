import { prisma } from "./client.ts";
import type { Prisma } from "./generated/prisma/client.ts";
import { nextVoteAction } from "@varroom/shared";

// db access for votes. same lock-then-recount pattern as comments.ts: every
// write locks the debate row first and recounts up_votes/down_votes/vote_score
// in the same transaction, so the counters always equal the vote rows

// fans voting on the same debate at once wait in line for the debate lock.
// each turn is a few round trips to neon, so the last one in a busy line can
// pass prisma's 5 second default and get cancelled. give it more room
const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 15000 };

// locks the debate row until the transaction ends, so other writers on this
// debate wait their turn. returns false if the debate doesn't exist
async function lockDebate(tx: Prisma.TransactionClient, debateId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM debates WHERE id = ${debateId}::uuid FOR UPDATE
  `;
  return rows.length > 0;
}

// sets up_votes/down_votes/vote_score from a fresh count. only call it after lockDebate
async function recountVotes(tx: Prisma.TransactionClient, debateId: string): Promise<void> {
  const upVotes = await tx.debateVote.count({ where: { debateId: debateId, value: 1 } });
  const downVotes = await tx.debateVote.count({ where: { debateId: debateId, value: -1 } });
  await tx.debate.update({
    where: { id: debateId },
    data: { upVotes: upVotes, downVotes: downVotes, voteScore: upVotes - downVotes },
  });
}

export type SetVoteResult = {
  outcome: "ok" | "debate_not_found";
  myVote: 1 | -1 | null; // the vote's value after the write, set when outcome is "ok"
};

// toggles a fan's vote on a debate: no row inserts one, the other value
// switches it, the same value again removes it. row write and recount run
// in one transaction, behind a lock on the debate row
export async function setVote(debateId: string, userId: string, value: 1 | -1): Promise<SetVoteResult> {
  return prisma.$transaction(async (tx) => {
    const debateFound = await lockDebate(tx, debateId);
    if (!debateFound) {
      return { outcome: "debate_not_found", myVote: null };
    }

    const existing = await tx.debateVote.findUnique({
      where: { debateId_userId: { debateId: debateId, userId: userId } },
      select: { value: true },
    });
    const current = existing ? (existing.value as 1 | -1) : null;

    const next = nextVoteAction(current, value);
    let myVote: 1 | -1 | null;

    if (next.action === "insert") {
      await tx.debateVote.create({
        data: { debateId: debateId, userId: userId, value: next.value },
      });
      myVote = next.value;
    } else if (next.action === "update") {
      await tx.debateVote.update({
        where: { debateId_userId: { debateId: debateId, userId: userId } },
        data: { value: next.value },
      });
      myVote = next.value;
    } else {
      await tx.debateVote.delete({
        where: { debateId_userId: { debateId: debateId, userId: userId } },
      });
      myVote = null;
    }

    await recountVotes(tx, debateId);

    return { outcome: "ok", myVote: myVote };
  }, TRANSACTION_OPTIONS);
}
