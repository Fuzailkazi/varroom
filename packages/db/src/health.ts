import { prisma } from "./client.ts";

export type DatabaseState = "up" | "down";

// fast ping to check db health. swallows errors so /api/health can handle them gracefully.
export async function checkDatabase(): Promise<DatabaseState> {
  if (!process.env.DATABASE_URL) return "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}
