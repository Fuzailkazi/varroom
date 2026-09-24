import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.ts";
import { loadEnv } from "../env.ts";

// dummy secret for tests
const TEST_SECRET = "test-secret-that-is-at-least-32-characters";

// spins up a test server on a random open port
export async function startTestServer() {
  // 1. Start an empty server on port 0, which means "any free port".
  const server: Server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  // 2. Find out which port we got.
  const address = server.address() as AddressInfo;
  const baseUrl = `http://localhost:${address.port}`;

  // 3. Build the app with that address, and plug it into the server.
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "test",
    // The test preload already pointed DATABASE_URL at the test branch,
    // or removed it. The placeholder only keeps loadEnv happy.
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://not-configured/none",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || TEST_SECRET,
    BETTER_AUTH_URL: baseUrl,
  });
  const app = createApp(env);
  server.on("request", app);

  return { server, baseUrl };
}
