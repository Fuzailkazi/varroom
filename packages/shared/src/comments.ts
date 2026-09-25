import { z } from "zod";
import { DebateAuthor } from "./debates.ts";

// request/response schemas for comments. shared with the web app

// windows line breaks -> \n, then trim. line breaks inside the text stay
function cleanBody(body: string): string {
  const unixLineBreaks = body.replace(/\r\n/g, "\n");
  return unixLineBreaks.trim();
}

// post /api/debates/:id/comments
export const CreateCommentRequest = z.object({
  body: z
    .string({ error: "Comment text is required." })
    .transform(cleanBody)
    .pipe(
      z
        .string()
        .min(1, { error: "Comment can't be empty." })
        .max(280, { error: "Comment must be at most 280 characters." }),
    ),
});

export type CreateCommentRequest = z.infer<typeof CreateCommentRequest>;

// get /api/debates/:id/comments
export const ListCommentsQuery = z.object({
  limit: z.coerce
    .number({ error: "limit must be a number." })
    .int({ error: "limit must be a whole number." })
    .min(1, { error: "limit must be at least 1." })
    .max(50, { error: "limit must be at most 50." })
    .default(20),

  // checked in the route, a bad one is INVALID_CURSOR not VALIDATION_FAILED
  cursor: z.string().optional(),
});

export type ListCommentsQuery = z.infer<typeof ListCommentsQuery>;

// the single comment shape returned by post and list
export const Comment = z.object({
  id: z.string(),
  debateId: z.string(),
  body: z.string(),
  author: DebateAuthor, // same shape as a debate's author
  createdAt: z.iso.datetime(),
});

export const ListCommentsResponse = z.object({
  items: z.array(Comment),
  nextCursor: z.string().nullable(), // null on last page
});

export type Comment = z.infer<typeof Comment>;
export type ListCommentsResponse = z.infer<typeof ListCommentsResponse>;
