import type { DebateRow } from "@varroom/db";
import { sortTags } from "@varroom/db";
import { Debate } from "@varroom/shared";
import type { DebateAuthor, LatestReview, TagSummary } from "@varroom/shared";

// Turns a debate from the database into the one Debate shape that POST,
// the list and the read route all return (spec 0004, AC-9).
// Having a single mapper means the three routes can never drift apart.

// Shown when the author deleted their account (spec 0003).
const DELETED_USER: DebateAuthor = {
  username: null,
  displayUsername: null,
  displayName: "deleted user",
  badge: null,
};

function toAuthor(row: DebateRow): DebateAuthor {
  const author = row.author;
  if (!author) {
    return DELETED_USER;
  }

  // Same fallback as /api/me: show the username if there is no display version.
  let displayUsername = author.displayUsername;
  if (!displayUsername) {
    displayUsername = author.username;
  }

  return {
    username: author.username,
    displayUsername: displayUsername,
    displayName: author.name,
    badge: author.badge,
  };
}

function toTags(row: DebateRow): TagSummary[] {
  const tags: TagSummary[] = [];
  for (const link of row.tags) {
    tags.push({ slug: link.tag.slug, name: link.tag.name, kind: link.tag.kind });
  }
  return sortTags(tags); // leagues first, then teams, A to Z
}

function toLatestReview(row: DebateRow): LatestReview | null {
  // getDebatesByIds asks for the newest review only, so there is 0 or 1.
  const review = row.reviews[0];
  if (!review) {
    return null;
  }

  let completedAt: string | null = null;
  if (review.completedAt) {
    completedAt = review.completedAt.toISOString();
  }

  return {
    id: review.id,
    status: review.status,
    decision: review.decision,
    credibilityScore: review.credibilityScore,
    summary: review.summary,
    createdAt: review.createdAt.toISOString(),
    completedAt: completedAt,
  };
}

// The vote table only holds 1 or -1 (a database CHECK), anything else is "no vote".
function toMyVote(value: number | undefined): 1 | -1 | null {
  if (value === 1) {
    return 1;
  }
  if (value === -1) {
    return -1;
  }
  return null;
}

// myVote is the viewer's vote on this debate, or undefined if they have none
// (or nobody is signed in).
export function toDebateResponse(row: DebateRow, myVote: number | undefined): Debate {
  // Debate.parse double checks the shape we promise in packages/shared.
  return Debate.parse({
    id: row.id,
    title: row.title,
    thesis: row.thesis,
    categories: row.categories,
    tags: toTags(row),
    author: toAuthor(row),
    createdAt: row.createdAt.toISOString(),
    upVotes: row.upVotes,
    downVotes: row.downVotes,
    voteScore: row.voteScore,
    commentCount: row.commentCount,
    credibilityScore: row.credibilityScore,
    latestReview: toLatestReview(row),
    myVote: toMyVote(myVote),
  });
}
