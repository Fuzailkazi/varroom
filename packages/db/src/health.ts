import { prisma } from "./client.ts";

export type DatabaseState = "up" | "down";

// Runs the cheapest possible query. Never throws: an unreachable or
// misconfigured database reports "down" so /api/health can answer 503.
export async function checkDatabase(): Promise<DatabaseState> {
  if (!process.env.DATABASE_URL) return "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}
