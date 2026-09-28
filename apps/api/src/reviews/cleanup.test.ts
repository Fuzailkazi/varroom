import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanUpOldAiCalls, startHourlyAiCallCleanup } from "./cleanup.ts";

// unit tests for the api's ai call cleanup, with a fake delete so no database is needed.
// the real delete is tested in packages/db

// the console spies of the current test, put back after each one
const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of spies) {
    spy.mockRestore();
  }
  spies.length = 0;
});

// silences console.log / console.error and records what was printed
function watchConsole() {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  spies.push(log, error);
  return { log: log, error: error };
}

// waits a few milliseconds, so a short timer gets a chance to fire
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("cleanUpOldAiCalls", () => {
  test("deletes once and logs how many rows went", async () => {
    const printed = watchConsole();
    let calls = 0;
    async function fakeDelete() {
      calls = calls + 1;
      return 7;
    }

    await cleanUpOldAiCalls(fakeDelete);

    expect(calls).toBe(1);
    expect(printed.log).toHaveBeenCalledWith("ai call cleanup: deleted 7 call row(s) older than 48 hours");
    expect(printed.error).not.toHaveBeenCalled();
  });

  test("logs 0 when nothing was old enough", async () => {
    const printed = watchConsole();

    await cleanUpOldAiCalls(async () => 0);

    expect(printed.log).toHaveBeenCalledWith("ai call cleanup: deleted 0 call row(s) older than 48 hours");
  });

  test("a failing delete is logged and never thrown, so it can't stop the api", async () => {
    const printed = watchConsole();
    const boom = new Error("database is down");

    // resolves instead of throwing
    await cleanUpOldAiCalls(async () => {
      throw boom;
    });

    expect(printed.error).toHaveBeenCalledTimes(1);
    expect(printed.error.mock.calls[0]?.[1]).toBe(boom);
    expect(printed.log).not.toHaveBeenCalled();
  });
});

describe("startHourlyAiCallCleanup", () => {
  test("keeps running on its timer, even after a run fails", async () => {
    const printed = watchConsole();
    let calls = 0;
    async function flakyDelete() {
      calls = calls + 1;
      if (calls === 1) {
        throw new Error("first run fails");
      }
      return 1;
    }

    // a 10ms interval stands in for an hour
    const timer = startHourlyAiCallCleanup(flakyDelete, 10);
    await wait(80);
    clearInterval(timer);

    expect(calls).toBeGreaterThanOrEqual(3);
    expect(printed.error).toHaveBeenCalledTimes(1);
    expect(printed.log).toHaveBeenCalledWith("ai call cleanup: deleted 1 call row(s) older than 48 hours");
  });

  test("doesn't run straight away, the startup run is separate", async () => {
    watchConsole();
    let calls = 0;

    const timer = startHourlyAiCallCleanup(async () => {
      calls = calls + 1;
      return 0;
    }, 50);
    await wait(10);
    clearInterval(timer);

    expect(calls).toBe(0);
  });

  test("the timer never keeps the process alive on its own", () => {
    const timer = startHourlyAiCallCleanup(async () => 0);
    const keepsAlive = timer.hasRef();
    clearInterval(timer);

    expect(keepsAlive).toBe(false);
  });
});
