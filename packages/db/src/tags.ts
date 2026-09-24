import { prisma } from "./client.ts";

export type TagRow = {
  id: number;
  slug: string;
  name: string;
  kind: "TEAM" | "LEAGUE";
};

// leagues first, then teams, a-z. sorted in code because postgres orders
// enums by declaration (TEAM before LEAGUE), which is backwards for us
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

// all tags, or just one kind
export async function listTags(kind?: "TEAM" | "LEAGUE"): Promise<TagRow[]> {
  const tags = await prisma.tag.findMany({
    where: { kind: kind },
  });
  return sortTags(tags);
}

// tags for these slugs. unknown slugs are just missing from the result
export function findTagsBySlugs(slugs: string[]): Promise<TagRow[]> {
  return prisma.tag.findMany({
    where: { slug: { in: slugs } },
  });
}
