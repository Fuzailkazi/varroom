// prisma generate wrapper. plain `prisma generate` wipes the typedsql types,
// and `--sql` needs a db connection. so we add --sql only when a db url is set
// (fresh clones without .env still work). used by postinstall and db:generate

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
