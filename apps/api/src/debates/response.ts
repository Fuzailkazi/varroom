import type { DebateRow } from "@varroom/db";
import { sortTags } from "@varroom/db";
import { Debate } from "@varroom/shared";
import type { DebateAuthor, LatestReview, TagSummary } from "@varroom/shared";

// db row -> shared Debate shape. single mapper so post/list/read can't drift

// placeholder author for deleted accounts
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

  // same fallback as /api/me
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
  return sortTags(tags); // leagues first, then teams, a-z
}

function toLatestReview(row: DebateRow): LatestReview | null {
  // getDebatesByIds only fetches the newest review, so 0 or 1
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

// db CHECK only allows 1 or -1, anything else counts as no vote
function toMyVote(value: number | undefined): 1 | -1 | null {
  if (value === 1) {
    return 1;
  }
  if (value === -1) {
    return -1;
  }
  return null;
}

// myVote = viewer's vote value, undefined when none or anonymous
export function toDebateResponse(row: DebateRow, myVote: number | undefined): Debate {
  // parse to make sure we match the shared schema
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
