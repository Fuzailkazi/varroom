import type { NextFunction, Request, Response } from "express";
import type { ErrorResponse, FieldError } from "@varroom/shared";

// optional extras on an error
export type ErrorExtras = {
  fields?: FieldError[]; // VALIDATION_FAILED
  existingId?: string; // DUPLICATE_DEBATE
};

// Every error our own routes send looks the same:
//   { "error": { "code": "EMAIL_NOT_VERIFIED", "message": "Confirm your email first." } }
// "code" is for programs (it never changes), "message" is for people.
export function sendError(res: Response, status: number, code: string, message: string, extras: ErrorExtras = {}) {
  const body: ErrorResponse = {
    error: { code: code, message: message },
  };
  if (extras.fields) {
    body.error.fields = extras.fields;
  }
  if (extras.existingId) {
    body.error.existingId = extras.existingId;
  }
  res.status(status).json(body);
}

// Express calls this when something throws. It must be added last, and
// Express knows it is an error handler because it takes 4 arguments.
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  // express.json() throws this when the request body is broken JSON.
  if (err && err.type === "entity.parse.failed") {
    sendError(res, 400, "INVALID_JSON", "The request body is not valid JSON.");
    return;
  }

  // Anything else is a bug on our side: log it, and answer in the same shape.
  console.error(err);
  sendError(res, 500, "INTERNAL_ERROR", "Something went wrong on our side.");
}
