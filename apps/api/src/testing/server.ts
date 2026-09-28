import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import type { ReviewRunnerOptions } from "../reviews/runner.ts";
import type { RateLimits } from "../security/rateLimit.ts";

// dummy secret for tests
const TEST_SECRET = "test-secret-that-is-at-least-32-characters";

// the whole test run shares one daily gemini budget, so by default it's too big to ever run out.
// the budget tests pass their own small AI_DAILY_CALL_LIMIT through envOverrides
const TEST_AI_DAILY_CALL_LIMIT = "1000000";

// many tests read the same review over and over, so by default the per ip rate
// limits are too high to ever trip. only the rate limit tests pass the real numbers
const TEST_RATE_LIMITS: RateLimits = {
  reviewReadsPerMinute: 1000000,
  reviewStreamsPerMinute: 1000000,
};

// spins up a test server on a random open port
// reviewRunnerOptions: fake agents / search / a short timeout for the review tests
// envOverrides: env vars to change for this server only, e.g. { AI_DAILY_CALL_LIMIT: "20" }
// rateLimits: the per ip, per minute limits on the public review reads
export async function startTestServer(
  reviewRunnerOptions: ReviewRunnerOptions = {},
  envOverrides: Record<string, string> = {},
  rateLimits: RateLimits = TEST_RATE_LIMITS,
) {
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
    // fixed limits, so the developer's .env can't change what the tests expect
    AI_DAILY_CALL_LIMIT: TEST_AI_DAILY_CALL_LIMIT,
    REVIEW_DAILY_LIMIT: "3",
    ...envOverrides,
  });
  const app = createApp(env, reviewRunnerOptions, rateLimits);
  server.on("request", app);

  return { server, baseUrl };
}
