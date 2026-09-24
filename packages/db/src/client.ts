import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

// The one Prisma client for the whole process. Only apps/api may import this
// subpath (@varroom/db/client); everything else uses the typed functions in
// src/index.ts. See spec 0001, "Prisma client and exports".
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "",
  // Fail fast instead of hanging when Neon is unreachable.
  connectionTimeoutMillis: 5_000,
});

export const prisma = new PrismaClient({ adapter });
