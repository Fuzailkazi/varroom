import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { ErrorResponse, HealthResponse } from "@varroom/shared";
import { startTestServer } from "./testing/server.ts";

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  ({ server, baseUrl } = await startTestServer());
});
afterAll(() => server.close());

describe("GET /api/health", () => {
  const originalUrl = process.env.DATABASE_URL;

  afterAll(() => {
    // Assigning undefined would store the string "undefined", so delete instead.
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  test("answers 503 with a valid body when the database is not configured", async () => {
    delete process.env.DATABASE_URL;
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(503);
    const body = HealthResponse.parse(await res.json());
    expect(body).toMatchObject({ status: "degraded", database: "down" });
  });

  test.skipIf(!originalUrl)("answers 200 when Neon is reachable", async () => {
    process.env.DATABASE_URL = originalUrl!;
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json()).database).toBe("up");
  });
});

describe("our error shape (AC-11)", () => {
  test("an unknown route answers 404 in the shared shape", async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe("NOT_FOUND");
  });

  test("a malformed JSON body answers 400 in the shared shape", async () => {
    const res = await fetch(`${baseUrl}/api/nope`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe("INVALID_JSON");
  });

  test("GET /api/me without a session answers 401 UNAUTHENTICATED (AC-7)", async () => {
    const res = await fetch(`${baseUrl}/api/me`);
    expect(res.status).toBe(401);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe("UNAUTHENTICATED");
  });
});
