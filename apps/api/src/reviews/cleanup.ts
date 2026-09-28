import { deleteOldAiCalls } from "@varroom/db";

// the per call detail of a review (ai_calls rows) is kept for 48 hours. the api deletes
// older rows once when it starts and then every hour. the review totals are never touched

const ONE_HOUR_MS = 60 * 60 * 1000;

// deletes the old rows once and logs how many went. it never throws: a failed cleanup
// just leaves the rows for the next run, it must never stop the api
export async function cleanUpOldAiCalls(deleteFn: () => Promise<number> = deleteOldAiCalls): Promise<void> {
  try {
    const deleted = await deleteFn();
    console.log(`ai call cleanup: deleted ${deleted} call row(s) older than 48 hours`);
  } catch (err) {
    console.error("ai call cleanup failed, will try again next hour:", err);
  }
}

// runs the cleanup every hour from now on. returns the timer so a test can stop it.
// unref() means this timer alone never keeps the process alive
export function startHourlyAiCallCleanup(
  deleteFn: () => Promise<number> = deleteOldAiCalls,
  intervalMs: number = ONE_HOUR_MS,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    // cleanUpOldAiCalls catches its own errors, so nothing can escape the timer
    void cleanUpOldAiCalls(deleteFn);
  }, intervalMs);
  timer.unref();
  return timer;
}
