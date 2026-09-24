import type { Response } from "express";
import type { z } from "zod";
import type { FieldError } from "@varroom/shared";
import { sendError } from "./errors.ts";

// parses body/query with a zod schema. returns the clean data, or sends
// 400 VALIDATION_FAILED (one fields entry per issue) and returns null
//   const body = validate(CreateDebateRequest, req.body, res);
//   if (!body) return; // 400 already sent
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
    // ["tags", 2] -> "tags.2". empty path = whole body was wrong
    let path = issue.path.join(".");
    if (path === "") {
      path = "body";
    }
    fields.push({ path: path, message: issue.message });
  }

  sendError(res, 400, "VALIDATION_FAILED", "Some inputs are not valid.", { fields: fields });
  return null;
}
