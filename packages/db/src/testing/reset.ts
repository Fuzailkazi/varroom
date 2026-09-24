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

// neon pooled host -> direct host. migrations need direct, the pooler can't hold the advisory lock (P1002)
function toDirectUrl(url: string): string {
  return url.replace("-pooler.", ".");
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

  // prisma migrate reset --force in packages/db, pointed at the test branch's direct url
  const dbFolder = join(import.meta.dir, "../..");
  const testDirectUrl = toDirectUrl(testUrl);
  const result = Bun.spawnSync(["bun", "--bun", "prisma", "migrate", "reset", "--force"], {
    cwd: dbFolder,
    env: { ...process.env, DIRECT_DATABASE_URL: testDirectUrl },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error("Resetting the test database failed:\n" + result.stderr.toString());
  }

  // reseed tags, posting a debate needs real slugs
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
  process.env.DIRECT_DATABASE_URL = testDirectUrl;
}
