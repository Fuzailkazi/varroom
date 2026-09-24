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

// debates api. origin + json checks already ran in app.ts before we get here

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DEBATES_PER_DAY = 5; // so one fan can't burn the ai budget

const Uuid = z.uuid();

export function createDebatesRouter() {
  const router = Router();
  router.post("/", requireVerified, createDebateHandler);
  router.get("/", optionalSession, listDebatesHandler);
  router.get("/:id", optionalSession, getDebateHandler);
  router.delete("/:id", requireSession, deleteDebateHandler);
  return router;
}

// helpers

// signed in user id, or null for anonymous
function viewerId(req: Request): string | null {
  if (!req.signedIn) {
    return null;
  }
  return req.signedIn.user.id;
}

// loads full debates for the ids, keeping the given order. skips ids that no longer exist
async function loadDebates(ids: string[], viewer: string | null): Promise<Debate[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await getDebatesByIds(ids);

  // prisma doesn't keep order, so index by id
  const rowsById = new Map<string, DebateRow>();
  for (const row of rows) {
    rowsById.set(row.id, row);
  }

  // viewer's votes, only when signed in
  let votes = new Map<string, number>();
  if (viewer) {
    votes = await getVotesForUser(viewer, ids);
  }

  // walk ids to keep the sql order
  const debates: Debate[] = [];
  for (const id of ids) {
    const row = rowsById.get(id);
    if (row) {
      debates.push(toDebateResponse(row, votes.get(id)));
    }
  }
  return debates;
}

// post /api/debates

async function createDebateHandler(req: Request, res: Response) {
  // requireVerified already ran, so signedIn is set and email is confirmed
  const authorId = req.signedIn!.user.id;

  // 1. validate + clean body
  const body = validate(CreateDebateRequest, req.body, res);
  if (!body) {
    return;
  }

  // 2. all tag slugs must exist - unknown slug is a validation error too
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

  // 3. duplicate check runs before the cap so a capped user still gets told it's a dupe
  const duplicateId = await findRecentDuplicate(authorId, body.title, body.thesis, oneDayAgo);
  if (duplicateId) {
    sendError(res, 409, "DUPLICATE_DEBATE", "You already posted this debate.", { existingId: duplicateId });
    return;
  }

  // 4. daily cap
  const postedToday = await countDebatesSince(authorId, oneDayAgo);
  if (postedToday >= MAX_DEBATES_PER_DAY) {
    sendError(res, 429, "POST_LIMIT_REACHED", "You can post 5 debates a day. Try again tomorrow.");
    return;
  }

  // 5. save, then read back in the shared debate shape
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

// get /api/debates

async function listDebatesHandler(req: Request, res: Response) {
  const query = validate(ListDebatesQuery, req.query, res);
  if (!query) {
    return;
  }

  // cursor must be an existing debate id
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

  // fetch limit + 1 to know if there's a next page
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

// get /api/debates/:id

async function getDebateHandler(req: Request, res: Response) {
  const id = String(req.params.id);

  // bad uuid would 500 in postgres, so check it here
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

// delete /api/debates/:id

async function deleteDebateHandler(req: Request, res: Response) {
  // requireSession already ran. unverified users can still delete their own posts
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

  // author only. orphaned debates (authorId null) are left for moderation
  if (debate.authorId !== userId) {
    sendError(res, 403, "FORBIDDEN", "You can only delete your own debates.");
    return;
  }

  await deleteDebate(id);
  res.status(204).end();
}

// get /api/tags

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
