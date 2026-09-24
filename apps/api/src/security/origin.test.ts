import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import type { Env } from "../env.ts";
import { getTrustedOrigins, requireTrustedOrigin } from "./origin.ts";

// csrf guard tests. calls the middleware with fake req/res, no server

type Sent = { status: number | undefined; code: string | undefined; nextCalled: boolean };

// run the guard once, capture what it did
function run(method: string, headers: Record<string, string>): Sent {
  const sent: Sent = { status: undefined, code: undefined, nextCalled: false };

  const req: any = {
    method: method,
    headers: headers,
    // mini version of express req.is()
    is(type: string) {
      const contentType = headers["content-type"] ?? "";
      if (contentType.startsWith(type)) {
        return type;
      }
      return false;
    },
  };

  const res: any = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: any) {
      sent.code = body.error.code;
      return res;
    },
  };

  const guard = requireTrustedOrigin(["http://localhost:3000"]);
  guard(req as Request, res as Response, () => {
    sent.nextCalled = true;
  });
  return sent;
}

describe("getTrustedOrigins", () => {
  test("is the origin of BETTER_AUTH_URL, without any path", () => {
    const env = { BETTER_AUTH_URL: "http://localhost:3001/anything" } as Env;
    expect(getTrustedOrigins(env)).toEqual(["http://localhost:3001"]);
  });
});

describe("requireTrustedOrigin", () => {
  test("lets a GET through without any Origin header", () => {
    const sent = run("GET", {});
    expect(sent.nextCalled).toBe(true);
    expect(sent.status).toBeUndefined();
  });

  test("lets a JSON POST from our own site through", () => {
    const sent = run("POST", { origin: "http://localhost:3000", "content-type": "application/json; charset=utf-8" });
    expect(sent.nextCalled).toBe(true);
  });

  test("refuses a POST with no Origin: 403 BAD_ORIGIN", () => {
    const sent = run("POST", { "content-type": "application/json" });
    expect(sent.nextCalled).toBe(false);
    expect(sent.status).toBe(403);
    expect(sent.code).toBe("BAD_ORIGIN");
  });

  test("refuses a POST from another website, even a lookalike", () => {
    const evil = run("POST", { origin: "https://evil.example", "content-type": "application/json" });
    expect(evil.status).toBe(403);
    expect(evil.code).toBe("BAD_ORIGIN");

    const lookalike = run("POST", { origin: "http://localhost:3000.evil.example", "content-type": "application/json" });
    expect(lookalike.status).toBe(403);
  });

  test("checks the origin before the content type", () => {
    const sent = run("POST", { origin: "https://evil.example", "content-type": "text/plain" });
    expect(sent.status).toBe(403);
    expect(sent.code).toBe("BAD_ORIGIN");
  });

  test("refuses a POST, PUT or PATCH that is not JSON: 415", () => {
    for (const method of ["POST", "PUT", "PATCH"]) {
      const sent = run(method, { origin: "http://localhost:3000", "content-type": "text/plain" });
      expect(sent.status).toBe(415);
      expect(sent.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect(sent.nextCalled).toBe(false);
    }
  });

  test("a DELETE needs a trusted origin but no content type", () => {
    const ok = run("DELETE", { origin: "http://localhost:3000" });
    expect(ok.nextCalled).toBe(true);

    const bad = run("DELETE", {});
    expect(bad.status).toBe(403);
    expect(bad.code).toBe("BAD_ORIGIN");
  });
});
