import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { runStartupJobs } from "./startup.ts";

// unit tests for what the api runs before it takes requests, with fake jobs so no
// database is needed

// the console spies and timers of the current test, cleaned up after each one
const spies: { mockRestore: () => void }[] = [];
const timers: ReturnType<typeof setInterval>[] = [];

afterEach(() => {
  for (const spy of spies) {
    spy.mockRestore();
  }
  spies.length = 0;
  for (const timer of timers) {
    clearInterval(timer);
  }
  timers.length = 0;
});

// the cleanup logs a line each run, keep the test output quiet
function silenceConsole() {
  spies.push(spyOn(console, "log").mockImplementation(() => {}));
  spies.push(spyOn(console, "error").mockImplementation(() => {}));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("runStartupJobs", () => {
  test("recovers interrupted reviews first, then deletes old calls once, before returning", async () => {
    silenceConsole();
    const order: string[] = [];

    const timer = await runStartupJobs({
      recover: async () => {
        order.push("recover");
      },
      deleteOldCalls: async () => {
        order.push("cleanup");
        return 0;
      },
    });
    timers.push(timer);

    expect(order).toEqual(["recover", "cleanup"]);
  });

  test("keeps deleting old calls on a timer after that", async () => {
    silenceConsole();
    let cleanups = 0;

    const timer = await runStartupJobs({
      recover: async () => {},
      deleteOldCalls: async () => {
        cleanups = cleanups + 1;
        return 0;
      },
      cleanupIntervalMs: 20,
    });
    timers.push(timer);
    await wait(70);

    // once at startup, then at least twice more from the timer
    expect(cleanups).toBeGreaterThanOrEqual(3);
  });

  test("a failing cleanup doesn't stop the api from starting", async () => {
    silenceConsole();

    const timer = await runStartupJobs({
      recover: async () => {},
      deleteOldCalls: async () => {
        throw new Error("database is down");
      },
    });
    timers.push(timer);

    expect(timer).toBeDefined();
  });
});
