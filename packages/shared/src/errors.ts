import { z } from "zod";

// One bad input in a request, e.g. { path: "tags.2", message: "Unknown tag." }
export const FieldError = z.object({
  path: z.string(),
  message: z.string(),
});

// standard error response format for our api routes
export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(), // stable error code (e.g., EMAIL_NOT_VERIFIED)
    message: z.string(), // human-readable message
    fields: z.array(FieldError).optional(), // only on VALIDATION_FAILED (spec 0004)
    existingId: z.uuid().optional(), // only on DUPLICATE_DEBATE (spec 0004)
  }),
});

export type FieldError = z.infer<typeof FieldError>;
export type ErrorResponse = z.infer<typeof ErrorResponse>;
