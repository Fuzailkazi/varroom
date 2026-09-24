import { z } from "zod";

// request/response schemas for the debates api. shared with the web app so both sides agree

export const DEBATE_CATEGORIES = ["TACTICAL", "TRANSFER", "PLAYER", "OTHER"] as const;
export const TAG_KINDS = ["TEAM", "LEAGUE"] as const;

export const DebateCategory = z.enum(DEBATE_CATEGORIES);
export const TagKind = z.enum(TAG_KINDS);

// cleaning helpers

// dedupe, keeps first occurrence
function removeRepeats(values: string[]): string[] {
  const kept: string[] = [];
  for (const value of values) {
    if (!kept.includes(value)) {
      kept.push(value);
    }
  }
  return kept;
}

function toUpperCaseList(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    result.push(value.trim().toUpperCase());
  }
  return result;
}

function toSlugList(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    result.push(value.trim().toLowerCase());
  }
  return result;
}

// titles are single line - newlines become spaces
function cleanTitle(title: string): string {
  const oneLine = title.replace(/[\r\n]+/g, " ");
  return oneLine.trim();
}

// post /api/debates

// unknown fields like focusPlayerId get dropped by z.object
export const CreateDebateRequest = z.object({
  title: z
    .string({ error: "Title is required." })
    .transform(cleanTitle)
    .pipe(
      z
        .string()
        .min(10, { error: "Title must be at least 10 characters." })
        .max(120, { error: "Title must be at most 120 characters." }),
    ),

  thesis: z
    .string({ error: "Thesis is required." })
    .trim()
    .min(30, { error: "Thesis must be at least 30 characters." })
    .max(1000, { error: "Thesis must be at most 1000 characters." }),

  // uppercase + dedupe first, then check count and values
  categories: z
    .array(z.string(), { error: "Pick 1 to 4 categories." })
    .transform(toUpperCaseList)
    .transform(removeRepeats)
    .pipe(
      z
        .array(DebateCategory)
        .min(1, { error: "Pick at least 1 category." })
        .max(4, { error: "Pick at most 4 categories." }),
    ),

  // slugs only - existence is checked against the db in the route
  tags: z
    .array(z.string(), { error: "Tags must be a list of tag slugs." })
    .transform(toSlugList)
    .transform(removeRepeats)
    .pipe(z.array(z.string()).max(5, { error: "Pick at most 5 tags." }))
    .default([]),
});

export type CreateDebateRequest = z.infer<typeof CreateDebateRequest>;

// get /api/debates

// query params come in as strings in any case (?sort=TOP, ?category=transfer)
export const ListDebatesQuery = z.object({
  sort: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(["new", "top"], { error: "sort must be new or top." }))
    .default("new"),

  limit: z.coerce
    .number({ error: "limit must be a number." })
    .int({ error: "limit must be a whole number." })
    .min(1, { error: "limit must be at least 1." })
    .max(50, { error: "limit must be at most 50." })
    .default(20),

  // validated in the route so a bad one is INVALID_CURSOR, not VALIDATION_FAILED
  cursor: z.string().optional(),

  category: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(DEBATE_CATEGORIES, { error: "Unknown category." }))
    .optional(),

  tag: z.string().trim().toLowerCase().optional(),

  // usernames are stored lowercase
  author: z.string().trim().toLowerCase().optional(),
});

export type ListDebatesQuery = z.infer<typeof ListDebatesQuery>;

// get /api/tags

export const ListTagsQuery = z.object({
  kind: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(TAG_KINDS, { error: "kind must be team or league." }))
    .optional(),
});

export const TagSummary = z.object({
  slug: z.string(),
  name: z.string(),
  kind: TagKind,
});

export const ListTagsResponse = z.object({
  items: z.array(TagSummary),
});

export type TagSummary = z.infer<typeof TagSummary>;
export type ListTagsResponse = z.infer<typeof ListTagsResponse>;

// the single debate shape returned by post, list and read

export const DebateAuthor = z.object({
  username: z.string().nullable(), // null = account deleted
  displayUsername: z.string().nullable(),
  displayName: z.string(), // "deleted user" when account is gone
  badge: z.enum(["SPECTATOR", "ASSISTANT_REF", "CHIEF_VAR"]).nullable(),
});

// newest review summary. decision/score/summary/completedAt are null until COMPLETE
export const LatestReview = z.object({
  id: z.string(),
  status: z.enum(["QUEUED", "RUNNING", "COMPLETE", "FAILED"]),
  decision: z.enum(["CONFIRMED", "OVERTURNED", "INCONCLUSIVE"]).nullable(),
  credibilityScore: z.number().int().nullable(),
  summary: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export const Debate = z.object({
  id: z.string(),
  title: z.string(),
  thesis: z.string(),
  categories: z.array(DebateCategory),
  tags: z.array(TagSummary),
  author: DebateAuthor,
  createdAt: z.iso.datetime(),
  upVotes: z.number().int(),
  downVotes: z.number().int(),
  voteScore: z.number().int(),
  commentCount: z.number().int(),
  credibilityScore: z.number().int().nullable(),
  latestReview: LatestReview.nullable(),
  myVote: z.union([z.literal(1), z.literal(-1)]).nullable(),
});

export const ListDebatesResponse = z.object({
  items: z.array(Debate),
  nextCursor: z.string().nullable(), // null on last page
});

export type DebateAuthor = z.infer<typeof DebateAuthor>;
export type LatestReview = z.infer<typeof LatestReview>;
export type Debate = z.infer<typeof Debate>;
export type ListDebatesResponse = z.infer<typeof ListDebatesResponse>;
