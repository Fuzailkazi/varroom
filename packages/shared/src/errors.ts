import { z } from "zod";

// standard error response format for our api routes
export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(), // stable error code (e.g., EMAIL_NOT_VERIFIED)
    message: z.string(), // human-readable message
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;
