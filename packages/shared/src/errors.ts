import { z } from "zod";

// one invalid input, e.g. { path: "tags.2", message: "Unknown tag." }
export const FieldError = z.object({
  path: z.string(),
  message: z.string(),
});

// standard error response format for our api routes
export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(), // stable error code (e.g., EMAIL_NOT_VERIFIED)
    message: z.string(), // human-readable message
    fields: z.array(FieldError).optional(), // only on VALIDATION_FAILED
    existingId: z.uuid().optional(), // only on DUPLICATE_DEBATE
    // only on REVIEW_LIMIT_REACHED (when a slot frees up) and
    // DAILY_BUDGET_REACHED (when the daily budget resets, next midnight pacific)
    retryAt: z.iso.datetime().optional(),
  }),
});

export type FieldError = z.infer<typeof FieldError>;
export type ErrorResponse = z.infer<typeof ErrorResponse>;
