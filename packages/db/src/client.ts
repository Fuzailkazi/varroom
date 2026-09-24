import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

// singleton prisma client. only the api should import this directly.
// other packages should use the data access functions in src/index.ts
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "",
  // Fail fast instead of hanging when Neon is unreachable.
  connectionTimeoutMillis: 5_000,
});

export const prisma = new PrismaClient({ adapter });
