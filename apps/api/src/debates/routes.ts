import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  countDebatesSince,
  createDebate,
  debateExists,
  deleteDebate,
  findRecentDuplicate,
  findTagsBySlugs,
  getDebateAuthor,
  getDebatesByIds,
  getVotesForUser,
  listDebateIds,
  listTags,
} from "@varroom/db";
import type { DebateRow } from "@varroom/db";
import { CreateDebateRequest, ListDebatesQuery, ListDebatesResponse, ListTagsQuery, ListTagsResponse } from "@varroom/shared";
import type { Debate, FieldError } from "@varroom/shared";
import { optionalSession, requireSession, requireVerified } from "../auth/guards.ts";
import { sendError } from "../errors.ts";
import { validate } from "../validate.ts";
import { toDebateResponse } from "./response.ts";

// The debates API (spec 0004). Mounted in app.ts:
//   app.use("/api/debates", createDebatesRouter());
//   app.get("/api/tags", listTagsHandler);
// The trusted origin and JSON checks for POST and DELETE already ran in
// app.ts (requireTrustedOrigin) before any request gets here.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DEBATES_PER_DAY = 5; // AC-4

const Uuid = z.uuid();

export function createDebatesRouter() {
  const router = Router();
  router.post("/", requireVerified, createDebateHandler);
  router.get("/", optionalSession, listDebatesHandler);
  router.get("/:id", optionalSession, getDebateHandler);
  router.delete("/:id", requireSession, deleteDebateHandler);
  return router;
}

// ---------------------------------------------------------------
// Helpers shared by the handlers
// ---------------------------------------------------------------

// The signed in fan's id, or null for an anonymous visitor.
function viewerId(req: Request): string | null {
  if (!req.signedIn) {
    return null;
  }
  return req.signedIn.user.id;
}

// Loads full debates for these ids and returns them as responses, in the
// same order as `ids`. Ids of debates that no longer exist are skipped.
async function loadDebates(ids: string[], viewer: string | null): Promise<Debate[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await getDebatesByIds(ids);

  // Prisma returns rows in any order, so index them by id first...
  const rowsById = new Map<string, DebateRow>();
  for (const row of rows) {
    rowsById.set(row.id, row);
  }

  // ...then the viewer's votes, if someone is signed in (AC-10).
  let votes = new Map<string, number>();
  if (viewer) {
    votes = await getVotesForUser(viewer, ids);
  }

  // ...and finally walk `ids` to keep the order the SQL gave us.
  const debates: Debate[] = [];
  for (const id of ids) {
    const row = rowsById.get(id);
    if (row) {
      debates.push(toDebateResponse(row, votes.get(id)));
    }
  }
  return debates;
}

// ---------------------------------------------------------------
// POST /api/debates (AC-1 to AC-5)
// ---------------------------------------------------------------

async function createDebateHandler(req: Request, res: Response) {
  // requireVerified ran first, so req.signedIn is set and the email is confirmed.
  const authorId = req.signedIn!.user.id;

  // 1. Check and clean the body (AC-2).
  const body = validate(CreateDebateRequest, req.body, res);
  if (!body) {
    return;
  }

  // 2. Every tag slug must exist (also AC-2, so it is a VALIDATION_FAILED too).
  const foundTags = await findTagsBySlugs(body.tags);
  const tagIdBySlug = new Map<string, number>();
  for (const tag of foundTags) {
    tagIdBySlug.set(tag.slug, tag.id);
  }

  const unknownTags: FieldError[] = [];
  const tagIds: number[] = [];
  for (let index = 0; index < body.tags.length; index++) {
    const slug = body.tags[index]!;
    const tagId = tagIdBySlug.get(slug);
    if (tagId === undefined) {
      unknownTags.push({ path: `tags.${index}`, message: `Unknown tag "${slug}".` });
    } else {
      tagIds.push(tagId);
    }
  }
  if (unknownTags.length > 0) {
    sendError(res, 400, "VALIDATION_FAILED", "Some inputs are not valid.", { fields: unknownTags });
    return;
  }

  const oneDayAgo = new Date(Date.now() - ONE_DAY_MS);

  // 3. The same post again in the last 24 hours? (AC-5, checked before the cap)
  const duplicateId = await findRecentDuplicate(authorId, body.title, body.thesis, oneDayAgo);
  if (duplicateId) {
    sendError(res, 409, "DUPLICATE_DEBATE", "You already posted this debate.", { existingId: duplicateId });
    return;
  }

  // 4. At most 5 debates in 24 hours (AC-4).
  const postedToday = await countDebatesSince(authorId, oneDayAgo);
  if (postedToday >= MAX_DEBATES_PER_DAY) {
    sendError(res, 429, "POST_LIMIT_REACHED", "You can post 5 debates a day. Try again tomorrow.");
    return;
  }

  // 5. Save it, then read it back in the one Debate shape (AC-1).
  const id = await createDebate({
    authorId: authorId,
    title: body.title,
    thesis: body.thesis,
    categories: body.categories,
    tagIds: tagIds,
  });

  const debates = await loadDebates([id], authorId);
  res.status(201).json(debates[0]);
}

// ---------------------------------------------------------------
// GET /api/debates (AC-6 to AC-8, AC-10)
// ---------------------------------------------------------------

async function listDebatesHandler(req: Request, res: Response) {
  const query = validate(ListDebatesQuery, req.query, res);
  if (!query) {
    return;
  }

  // AC-8: the cursor must be the id of a debate that still exists.
  if (query.cursor !== undefined) {
    const isUuid = Uuid.safeParse(query.cursor).success;
    let exists = false;
    if (isUuid) {
      exists = await debateExists(query.cursor);
    }
    if (!exists) {
      sendError(res, 400, "INVALID_CURSOR", "This page link is out of date. Start again from the first page.");
      return;
    }
  }

  // Ask for one row more than we show: if it comes back, there is a next page.
  const ids = await listDebateIds({
    sort: query.sort,
    limit: query.limit + 1,
    cursorId: query.cursor,
    category: query.category,
    tag: query.tag,
    author: query.author,
  });

  const hasNextPage = ids.length > query.limit;
  const pageIds = ids.slice(0, query.limit);

  let nextCursor: string | null = null;
  if (hasNextPage) {
    nextCursor = pageIds[pageIds.length - 1]!;
  }

  const items = await loadDebates(pageIds, viewerId(req));
  const body = ListDebatesResponse.parse({ items: items, nextCursor: nextCursor });
  res.json(body);
}

// ---------------------------------------------------------------
// GET /api/debates/:id (AC-9, AC-10)
// ---------------------------------------------------------------

async function getDebateHandler(req: Request, res: Response) {
  const id = String(req.params.id);

  // A malformed id never reaches Postgres (it would be a 500 there).
  if (!Uuid.safeParse(id).success) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }

  const debates = await loadDebates([id], viewerId(req));
  const debate = debates[0];
  if (!debate) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }
  res.json(debate);
}

// ---------------------------------------------------------------
// DELETE /api/debates/:id (AC-11)
// ---------------------------------------------------------------

async function deleteDebateHandler(req: Request, res: Response) {
  // requireSession ran first. An unconfirmed fan may delete their own post.
  const userId = req.signedIn!.user.id;
  const id = String(req.params.id);

  if (!Uuid.safeParse(id).success) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }

  const debate = await getDebateAuthor(id);
  if (!debate.found) {
    sendError(res, 404, "NOT_FOUND", "No such debate.");
    return;
  }

  // Only the author may delete. A debate whose author deleted their
  // account (authorId null) can't be deleted here; moderation comes later.
  if (debate.authorId !== userId) {
    sendError(res, 403, "FORBIDDEN", "You can only delete your own debates.");
    return;
  }

  await deleteDebate(id);
  res.status(204).end();
}

// ---------------------------------------------------------------
// GET /api/tags (AC-12)
// ---------------------------------------------------------------

export async function listTagsHandler(req: Request, res: Response) {
  const query = validate(ListTagsQuery, req.query, res);
  if (!query) {
    return;
  }

  const tags = await listTags(query.kind);

  const items = [];
  for (const tag of tags) {
    items.push({ slug: tag.slug, name: tag.name, kind: tag.kind });
  }
  res.json(ListTagsResponse.parse({ items: items }));
}
