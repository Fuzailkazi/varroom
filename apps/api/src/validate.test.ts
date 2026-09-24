import { describe, expect, test } from "bun:test";
import type { Response } from "express";
import { z } from "zod";
import { validate } from "./validate.ts";

// validate() -> 400 VALIDATION_FAILED with a fields list. uses a fake res, no server

type FakeResponse = Response & { sentStatus: number | undefined; sentBody: any };

function fakeResponse(): FakeResponse {
  const res: any = {
    sentStatus: undefined,
    sentBody: undefined,
    status(code: number) {
      res.sentStatus = code;
      return res; // chainable like express
    },
    json(body: unknown) {
      res.sentBody = body;
      return res;
    },
  };
  return res;
}

const Schema = z.object({
  name: z.string().min(2, { error: "Name must be at least 2 characters." }),
  tags: z.array(z.string().min(1, { error: "Empty tag." })).max(2, { error: "At most 2 tags." }),
});

describe("validate", () => {
  test("returns the cleaned data and sends nothing when the input is fine", () => {
    const res = fakeResponse();
    const data = validate(Schema, { name: "Jude", tags: ["a"] }, res);
    expect(data).toEqual({ name: "Jude", tags: ["a"] });
    expect(res.sentStatus).toBeUndefined();
  });

  test("answers 400 VALIDATION_FAILED with one field entry per problem and returns null", () => {
    const res = fakeResponse();
    const data = validate(Schema, { name: "J", tags: ["a", "b", "c"] }, res);
    expect(data).toBeNull();
    expect(res.sentStatus).toBe(400);
    expect(res.sentBody.error.code).toBe("VALIDATION_FAILED");
    expect(res.sentBody.error.fields).toEqual([
      { path: "name", message: "Name must be at least 2 characters." },
      { path: "tags", message: "At most 2 tags." },
    ]);
  });

  test("joins nested paths with dots, like tags.1", () => {
    const res = fakeResponse();
    validate(Schema, { name: "Jude", tags: ["a", ""] }, res);
    expect(res.sentBody.error.fields).toEqual([{ path: "tags.1", message: "Empty tag." }]);
  });

  test("uses the path 'body' when the whole input is wrong", () => {
    const res = fakeResponse();
    validate(Schema, "not an object", res);
    expect(res.sentStatus).toBe(400);
    expect(res.sentBody.error.fields[0].path).toBe("body");
  });
});
