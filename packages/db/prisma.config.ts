import { defineConfig } from "prisma/config";

// Config for the Prisma CLI (generate, migrate). The running app connects
// through the driver adapter in src/client.ts instead.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // `prisma generate` needs no database, so an empty URL is fine until
    // .env exists. Migrations (feature 3) switch this to DIRECT_DATABASE_URL.
    url: process.env.DATABASE_URL ?? "",
  },
});
