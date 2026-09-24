import { join } from "node:path";

// test db setup: clears the test db and runs migrations before tests
// ensures we don't accidentally wipe the dev database

// normalizes neon connection strings to compare hosts
function getBranchHost(url: string | undefined): string {
  if (!url) {
    return "";
  }
  try {
    const host = new URL(url).hostname;
    return host.replace("-pooler", "");
  } catch {
    return ""; // not a valid URL
  }
}

// strip dev db urls to prevent accidental test pollution
function removeDatabaseUrls() {
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_DATABASE_URL;
}

const testUrl = process.env.DATABASE_URL_TEST;

if (!testUrl) {
  // No test database yet: skip the database tests instead of using dev.
  removeDatabaseUrls();
  console.warn("DATABASE_URL_TEST is not set, so database tests are skipped. See .env.example.");
} else {
  // Safety check: refuse to wipe the dev database by mistake.
  const testHost = getBranchHost(testUrl);
  const devHost = getBranchHost(process.env.DATABASE_URL);
  const devDirectHost = getBranchHost(process.env.DIRECT_DATABASE_URL);

  if (testHost === "" || testHost === devHost || testHost === devDirectHost) {
    removeDatabaseUrls();
    throw new Error("DATABASE_URL_TEST must be the Neon `test` branch, not `dev`. Refusing to reset it.");
  }

  // Run `prisma migrate reset --force` inside packages/db.
  // prisma.config.ts reads DIRECT_DATABASE_URL, so we give it the test URL.
  const dbFolder = join(import.meta.dir, "../..");
  const result = Bun.spawnSync(["bun", "--bun", "prisma", "migrate", "reset", "--force"], {
    cwd: dbFolder,
    env: { ...process.env, DIRECT_DATABASE_URL: testUrl },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error("Resetting the test database failed:\n" + result.stderr.toString());
  }

  // Fill the tags again (spec 0004): posting a debate needs real tag slugs.
  const seed = Bun.spawnSync(["bun", "prisma/seed.ts"], {
    cwd: dbFolder,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (seed.exitCode !== 0) {
    throw new Error("Seeding the test database failed:\n" + seed.stderr.toString());
  }

  // From now on, the app and the tests talk to the test database.
  process.env.DATABASE_URL = testUrl;
  process.env.DIRECT_DATABASE_URL = testUrl;
}
