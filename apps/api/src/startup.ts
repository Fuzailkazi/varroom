import { deleteOldAiCalls } from "@varroom/db";
import { cleanUpOldAiCalls, startHourlyAiCallCleanup } from "./reviews/cleanup.ts";
import { recoverInterruptedReviews } from "./reviews/runner.ts";

// the jobs the api runs before it takes requests. each part can be swapped,
// so a test can check the order without a database
export type StartupJobs = {
  recover: () => Promise<void>; // fails the reviews the last process left running
  deleteOldCalls: () => Promise<number>; // deletes call rows older than 48 hours
  cleanupIntervalMs?: number; // how often the cleanup runs again, every hour when left out
};

const REAL_JOBS: StartupJobs = {
  recover: recoverInterruptedReviews,
  deleteOldCalls: deleteOldAiCalls,
};

// runs the startup jobs in order and returns the hourly cleanup timer
export async function runStartupJobs(jobs: StartupJobs = REAL_JOBS): Promise<ReturnType<typeof setInterval>> {
  // 1. reviews the last process was running were cut off. fail them before taking requests
  await jobs.recover();

  // 2. per call detail older than 48 hours goes now, then every hour. neither ever throws
  await cleanUpOldAiCalls(jobs.deleteOldCalls);
  return startHourlyAiCallCleanup(jobs.deleteOldCalls, jobs.cleanupIntervalMs);
}
