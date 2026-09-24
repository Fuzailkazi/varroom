import { prisma } from "./client.ts";

export type TagRow = {
  id: number;
  slug: string;
  name: string;
  kind: "TEAM" | "LEAGUE";
};

// Leagues first, then teams, each A to Z by name (spec 0004).
// We sort in code because Postgres sorts an enum in the order it was
// declared (TEAM before LEAGUE), which is the wrong way round here.
export function sortTags<T extends { name: string; kind: "TEAM" | "LEAGUE" }>(tags: T[]): T[] {
  const leagues: T[] = [];
  const teams: T[] = [];
  for (const tag of tags) {
    if (tag.kind === "LEAGUE") {
      leagues.push(tag);
    } else {
      teams.push(tag);
    }
  }

  leagues.sort((a, b) => a.name.localeCompare(b.name));
  teams.sort((a, b) => a.name.localeCompare(b.name));
  return [...leagues, ...teams];
}

// GET /api/tags. kind is optional; without it we return every tag.
export async function listTags(kind?: "TEAM" | "LEAGUE"): Promise<TagRow[]> {
  const tags = await prisma.tag.findMany({
    where: { kind: kind },
  });
  return sortTags(tags);
}

// The tags with these slugs. Slugs that don't exist are simply missing
// from the result, so the caller can tell which ones were unknown.
export function findTagsBySlugs(slugs: string[]): Promise<TagRow[]> {
  return prisma.tag.findMany({
    where: { slug: { in: slugs } },
  });
}
