// Prisma Client can be generated without a database. TypedSQL needs one, so
// offline installs restore the last generated query modules checked into Git.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const hasDatabase = Boolean(process.env.DIRECT_DATABASE_URL);
const command = ["bun", "--bun", "prisma", "generate"];
if (hasDatabase) {
  command.push("--sql");
}

const result = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
if (result.exitCode !== 0) {
  process.exit(result.exitCode);
}

const generated = join(import.meta.dir, "../src/generated/prisma");
const snapshot = join(import.meta.dir, "../prisma/generated-sql");
const source = hasDatabase ? generated : snapshot;
const destination = hasDatabase ? snapshot : generated;

mkdirSync(destination, { recursive: true });
cpSync(join(source, "sql.ts"), join(destination, "sql.ts"));
cpSync(join(source, "sql"), join(destination, "sql"), { recursive: true, force: true });

if (hasDatabase) {
  for (const file of [
    "sql.ts",
    "sql/$DbEnums.ts",
    "sql/listNewDebateIds.ts",
    "sql/listTopDebateIds.ts",
  ]) {
    const path = join(snapshot, file);
    writeFileSync(path, readFileSync(path, "utf8").replace(/[ \t]+$/gm, ""));
  }
}

if (!hasDatabase) {
  console.log("Restored TypedSQL query modules from the checked-in snapshot.");
}
