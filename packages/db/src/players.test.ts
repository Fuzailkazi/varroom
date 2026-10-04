import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "./client.ts";

// tests that the pg_trgm extension and the trigram index on player names exist
// and support typo-tolerant similarity and substring queries

const onTestDatabase =
  Boolean(process.env.DATABASE_URL_TEST) &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

describe.skipIf(!onTestDatabase)("pg_trgm player name search index", () => {
  const testPlayerId = 999998;

  beforeAll(async () => {
    await prisma.player.deleteMany({ where: { id: testPlayerId } });
  });

  afterAll(async () => {
    await prisma.player.deleteMany({ where: { id: testPlayerId } });
  });

  test("pg_trgm extension is active in Postgres", async () => {
    const extensions = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
    `;
    expect(extensions.length).toBe(1);
    expect(extensions[0]?.extname).toBe("pg_trgm");
  });

  test("players_name_trgm_idx exists on players as a GIN index using gin_trgm_ops", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'players' AND indexname = 'players_name_trgm_idx';
    `;
    expect(indexes.length).toBe(1);
    expect(indexes[0]?.indexname).toBe("players_name_trgm_idx");
    expect(indexes[0]?.indexdef.toLowerCase()).toContain("using gin");
    expect(indexes[0]?.indexdef.toLowerCase()).toContain("gin_trgm_ops");
  });

  test("supports typo-tolerant search and similarity matching on player names", async () => {
    await prisma.player.create({
      data: {
        id: testPlayerId,
        name: "Jude Bellingham",
        nickname: "Jude",
        countryName: "England",
      },
    });

    // 1. Case-insensitive substring query accelerated by gin_trgm_ops
    const ilikeMatch = await prisma.player.findMany({
      where: {
        name: {
          contains: "ellingham",
          mode: "insensitive",
        },
      },
    });
    expect(ilikeMatch.some((p) => p.id === testPlayerId)).toBe(true);

    // 2. Trigram similarity function and % similarity operator query (typo tolerant)
    const trigramMatch = await prisma.$queryRaw<Array<{ id: number; name: string; sim: number }>>`
      SELECT id, name, similarity(name, 'Belingham') as sim
      FROM players
      WHERE name % 'Belingham' OR similarity(name, 'Belingham') > 0.3
      ORDER BY sim DESC;
    `;
    expect(trigramMatch.some((p) => p.id === testPlayerId)).toBe(true);
  });
});
