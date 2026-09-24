import type { Response } from "express";
import type { z } from "zod";
import type { FieldError } from "@varroom/shared";
import { sendError } from "./errors.ts";

// Checks request data (a body or a query) against a Zod schema.
//
//   const body = validate(CreateDebateRequest, req.body, res);
//   if (!body) return; // a 400 was already sent
//
// On success it returns the cleaned data. On failure it answers
// 400 VALIDATION_FAILED with one entry in "fields" per bad input
// (spec 0004, AC-2), and returns null.
export function validate<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
  res: Response,
): z.infer<Schema> | null {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  const fields: FieldError[] = [];
  for (const issue of result.error.issues) {
    // issue.path is a list like ["tags", 2]; we send it as "tags.2".
    // An empty path means the whole body was wrong (e.g. it was not an object).
    let path = issue.path.join(".");
    if (path === "") {
      path = "body";
    }
    fields.push({ path: path, message: issue.message });
  }

  sendError(res, 400, "VALIDATION_FAILED", "Some inputs are not valid.", { fields: fields });
  return null;
}
