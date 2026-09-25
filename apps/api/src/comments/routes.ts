import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { commentBelongsToDebate, createComment, debateExists, deleteComment, getCommentForDelete, listComments } from "@varroom/db";
import type { CommentRow } from "@varroom/db";
import { Comment, CreateCommentRequest, ListCommentsQuery, ListCommentsResponse } from "@varroom/shared";
import { requireSession, requireVerified } from "../auth/guards.ts";
import { toAuthorResponse } from "../debates/response.ts";
import { sendError } from "../errors.ts";
import { validate } from "../validate.ts";

// comments api. two routers because the debate id lives in the mount path for
// post/list but not for delete. origin + json checks already ran in app.ts

const Uuid = z.uuid();

// mounted at /api/debates/:id/comments. mergeParams lets us read :id from the mount path
export function createDebateCommentsRouter() {
  const router = Router({ mergeParams: true });
  router.post("/", requireVerified, createCommentHandler);
  router.get("/", listCommentsHandler);
  return router;
}

// mounted at /api/comments
export function createCommentsRouter() {
  const router = Router();
  router.delete("/:id", requireSession, deleteCommentHandler);
  return router;
}

// db row -> shared Comment shape
export function toCommentResponse(row: CommentRow): Comment {
  return Comment.parse({
    id: row.id,
    debateId: row.debateId,
    body: row.body,
    author: toAuthorResponse(row.author),
    createdAt: row.createdAt.toISOString(),
  });
}

function isUuid(value: string): boolean {
  return Uuid.safeParse(value).success;
}

// post /api/debates/:id/comments
async function createCommentHandler(req: Request, res: Response) {
  // requireVerified already ran, so signedIn is set
  const authorId = req.signedIn!.user.id;
  const debateId = String(req.params.id);

  if (!isUuid(debateId)) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }

  const body = validate(CreateCommentRequest, req.body, res);
  if (!body) {
    return;
  }

  const result = await createComment(debateId, authorId, body.body);

  if (result.outcome === "debate_not_found") {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }

  if (result.outcome === "duplicate") {
    sendError(res, 409, "DUPLICATE_COMMENT", "You just posted this comment.", { existingId: result.existingId });
    return;
  }

  if (result.comment) {
    res.status(201).json(toCommentResponse(result.comment));
  }
}

// get /api/debates/:id/comments
async function listCommentsHandler(req: Request, res: Response) {
  const debateId = String(req.params.id);

  if (!isUuid(debateId)) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }

  const query = validate(ListCommentsQuery, req.query, res);
  if (!query) {
    return;
  }

  const debateFound = await debateExists(debateId);
  if (!debateFound) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }

  // cursor must be a comment of this debate
  if (query.cursor !== undefined) {
    let cursorOk = false;
    if (isUuid(query.cursor)) {
      cursorOk = await commentBelongsToDebate(query.cursor, debateId);
    }
    if (!cursorOk) {
      sendError(res, 400, "INVALID_CURSOR", "This page link is out of date. Start again from the first page.");
      return;
    }
  }

  // fetch one extra row. if it comes back, there's a next page
  const rows = await listComments(debateId, query.limit + 1, query.cursor);
  const hasNextPage = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);

  const items: Comment[] = [];
  let lastId: string | null = null;
  for (const row of pageRows) {
    items.push(toCommentResponse(row));
    lastId = row.id;
  }

  let nextCursor: string | null = null;
  if (hasNextPage) {
    nextCursor = lastId;
  }

  res.json(ListCommentsResponse.parse({ items: items, nextCursor: nextCursor }));
}

// delete /api/comments/:id
async function deleteCommentHandler(req: Request, res: Response) {
  // requireSession already ran. unverified fans can still delete their own
  const userId = req.signedIn!.user.id;
  const id = String(req.params.id);

  if (!isUuid(id)) {
    sendError(res, 404, "NOT_FOUND", "No such comment.");
    return;
  }

  const comment = await getCommentForDelete(id);
  if (!comment) {
    sendError(res, 404, "NOT_FOUND", "No such comment.");
    return;
  }

  // author only. a comment whose author is gone (null) is left for moderation
  if (comment.authorId !== userId) {
    sendError(res, 403, "FORBIDDEN", "You can only delete your own comments.");
    return;
  }

  await deleteComment(id, comment.debateId);
  res.status(204).end();
}
