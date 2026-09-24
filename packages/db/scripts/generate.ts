// Generates the Prisma Client, plus the TypedSQL query types (prisma/sql/*.sql).
//
// Why a script: `prisma generate` on its own DELETES the TypedSQL types,
// and `prisma generate --sql` needs a database connection to read the
// column types. So we add --sql whenever a database URL is set, and warn
// when it is not (for example a fresh clone before .env exists).
// Both `bun install` (postinstall) and `bun run db:generate` run this.

const hasDatabase = Boolean(process.env.DIRECT_DATABASE_URL);

const command = ["bun", "--bun", "prisma", "generate"];
if (hasDatabase) {
  command.push("--sql");
} else {
  console.warn("DIRECT_DATABASE_URL is not set, so the TypedSQL queries were not generated.");
  console.warn("Set it in .env, then run `bun run db:generate`.");
}

const result = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
process.exit(result.exitCode);
