import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HealthResponse } from "@varroom/shared";
import { createApp } from "./app.ts";

describe("GET /api/health", () => {
  let server: Server;
  let baseUrl: string;
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    // Port 0 asks the OS for any free port.
    server = createApp().listen(0);
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    // Assigning undefined would store the string "undefined", so delete instead.
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    server.close();
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
