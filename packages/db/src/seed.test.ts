import { describe, expect, test } from "bun:test";
import { buildTagList, toSlug } from "../prisma/seed.ts";

// seed list + slug rule, no db. idempotency is covered by the integration tests

describe("toSlug", () => {
  test("lowercases and joins words with a dash", () => {
    expect(toSlug("Premier League")).toBe("premier-league");
    expect(toSlug("Bayern Munich")).toBe("bayern-munich");
  });

  test("removes accents", () => {
    expect(toSlug("Atlético Madrid")).toBe("atletico-madrid");
    expect(toSlug("Borussia Mönchengladbach")).toBe("borussia-monchengladbach");
    expect(toSlug("Türkiye")).toBe("turkiye");
  });

  test("turns symbols into a single dash and trims dashes at the ends", () => {
    expect(toSlug("Brighton & Hove Albion")).toBe("brighton-hove-albion");
    expect(toSlug("  Paris FC  ")).toBe("paris-fc");
    expect(toSlug("Schalke 04")).toBe("schalke-04");
  });
});

describe("buildTagList", () => {
  const tags = buildTagList();

  test("has 151 tags: 7 leagues and 144 teams", () => {
    let leagues = 0;
    let teams = 0;
    for (const tag of tags) {
      if (tag.kind === "LEAGUE") leagues++;
      if (tag.kind === "TEAM") teams++;
    }
    expect(tags.length).toBe(151);
    expect(leagues).toBe(7);
    expect(teams).toBe(144);
  });

  test("every slug is unique, so the upsert by slug can never clash", () => {
    const seen = new Set<string>();
    for (const tag of tags) {
      expect(seen.has(tag.slug)).toBe(false);
      seen.add(tag.slug);
    }
  });

  test("every slug is lowercase ASCII letters, digits and dashes", () => {
    for (const tag of tags) {
      expect(tag.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  test("leagues come first in the list, and include the UEFA cups", () => {
    expect(tags[0]?.kind).toBe("LEAGUE");
    expect(tags[6]?.kind).toBe("LEAGUE");
    expect(tags[7]?.kind).toBe("TEAM");
    const slugs = tags.map((tag) => tag.slug);
    expect(slugs).toContain("champions-league");
    expect(slugs).toContain("europa-league");
  });

  test("contains the slugs the API tests rely on", () => {
    const slugs = tags.map((tag) => tag.slug);
    for (const slug of ["arsenal", "chelsea", "premier-league", "bayern-munich", "atletico-madrid", "inter-milan", "paris-saint-germain"]) {
      expect(slugs).toContain(slug);
    }
  });
});
