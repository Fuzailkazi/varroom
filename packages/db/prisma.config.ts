import { defineConfig } from "prisma/config";

// Config for the Prisma CLI (generate, migrate). The running app connects
// through the driver adapter in src/client.ts instead.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Migrations need a direct (not pooled) Neon connection, because the
    // pooler cannot hold the lock a migration takes. `prisma generate` needs
    // no database at all, so an empty URL is fine before .env exists.
    url: process.env.DIRECT_DATABASE_URL ?? "",
  },
});
