import { prisma } from "../src/client.ts";

// Fills the tags table with leagues, clubs and national teams (spec 0004, AC-12).
// Run it with `bun run db:seed`. It is safe to run again: each tag is
// "upserted" by its slug (updated if it exists, created if not), so a
// second run changes nothing.
//
// Refresh the club lists every summer (promotion and relegation).
// Old club tags stay in the table and keep working.

const LEAGUES = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Champions League",
  "Europa League",
];

// Clubs of the five big leagues, season 2026/27 (source: Wikipedia's
// "2026–27 <league>" pages, checked on 2026-09-24).
const PREMIER_LEAGUE_CLUBS = [
  "Arsenal",
  "Aston Villa",
  "Bournemouth",
  "Brentford",
  "Brighton & Hove Albion",
  "Chelsea",
  "Coventry City",
  "Crystal Palace",
  "Everton",
  "Fulham",
  "Hull City",
  "Ipswich Town",
  "Leeds United",
  "Liverpool",
  "Manchester City",
  "Manchester United",
  "Newcastle United",
  "Nottingham Forest",
  "Sunderland",
  "Tottenham Hotspur",
];

const LA_LIGA_CLUBS = [
  "Alavés",
  "Athletic Bilbao",
  "Atlético Madrid",
  "Barcelona",
  "Celta Vigo",
  "Deportivo La Coruña",
  "Elche",
  "Espanyol",
  "Getafe",
  "Levante",
  "Málaga",
  "Osasuna",
  "Racing Santander",
  "Rayo Vallecano",
  "Real Betis",
  "Real Madrid",
  "Real Sociedad",
  "Sevilla",
  "Valencia",
  "Villarreal",
];

const SERIE_A_CLUBS = [
  "Atalanta",
  "Bologna",
  "Cagliari",
  "Como",
  "Fiorentina",
  "Frosinone",
  "Genoa",
  "Inter Milan",
  "Juventus",
  "Lazio",
  "Lecce",
  "AC Milan",
  "Monza",
  "Napoli",
  "Parma",
  "Roma",
  "Sassuolo",
  "Torino",
  "Udinese",
  "Venezia",
];

const BUNDESLIGA_CLUBS = [
  "Augsburg",
  "Bayer Leverkusen",
  "Bayern Munich",
  "Borussia Dortmund",
  "Borussia Mönchengladbach",
  "Cologne",
  "Eintracht Frankfurt",
  "Hamburger SV",
  "Hoffenheim",
  "Mainz",
  "RB Leipzig",
  "SC Freiburg",
  "SC Paderborn",
  "Schalke 04",
  "SV Elversberg",
  "Stuttgart",
  "Union Berlin",
  "Werder Bremen",
];

const LIGUE_1_CLUBS = [
  "Angers",
  "Auxerre",
  "Brest",
  "Le Havre",
  "Le Mans",
  "Lens",
  "Lille",
  "Lorient",
  "Lyon",
  "Marseille",
  "Monaco",
  "Nice",
  "Paris FC",
  "Paris Saint-Germain",
  "Rennes",
  "Strasbourg",
  "Toulouse",
  "Troyes",
];

// The 48 national teams at the 2026 World Cup.
const WORLD_CUP_NATIONS = [
  "Algeria",
  "Argentina",
  "Australia",
  "Austria",
  "Belgium",
  "Bosnia and Herzegovina",
  "Brazil",
  "Canada",
  "Cape Verde",
  "Colombia",
  "Croatia",
  "Curaçao",
  "Czechia",
  "DR Congo",
  "Ecuador",
  "Egypt",
  "England",
  "France",
  "Germany",
  "Ghana",
  "Haiti",
  "Iran",
  "Iraq",
  "Ivory Coast",
  "Japan",
  "Jordan",
  "Mexico",
  "Morocco",
  "Netherlands",
  "New Zealand",
  "Norway",
  "Panama",
  "Paraguay",
  "Portugal",
  "Qatar",
  "Saudi Arabia",
  "Scotland",
  "Senegal",
  "South Africa",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "Tunisia",
  "Türkiye",
  "United States",
  "Uruguay",
  "Uzbekistan",
];

// Turns a name into a slug:
//   "Atlético Madrid"        -> "atletico-madrid"
//   "Brighton & Hove Albion" -> "brighton-hove-albion"
export function toSlug(name: string): string {
  // "NFD" splits "é" into "e" plus a separate accent mark,
  // and the next line removes those accent marks.
  const split = name.normalize("NFD");
  const noAccents = split.replace(/[̀-ͯ]/g, "");
  const lower = noAccents.toLowerCase();
  // Anything that is not a letter or a digit becomes "-".
  const dashed = lower.replace(/[^a-z0-9]+/g, "-");
  // Remove a "-" at the start or the end.
  return dashed.replace(/^-+|-+$/g, "");
}

type SeedTag = {
  slug: string;
  name: string;
  kind: "TEAM" | "LEAGUE";
};

// All tags as one list: leagues first, then clubs, then nations.
export function buildTagList(): SeedTag[] {
  const tags: SeedTag[] = [];

  for (const name of LEAGUES) {
    tags.push({ slug: toSlug(name), name: name, kind: "LEAGUE" });
  }

  const allTeams = [
    ...PREMIER_LEAGUE_CLUBS,
    ...LA_LIGA_CLUBS,
    ...SERIE_A_CLUBS,
    ...BUNDESLIGA_CLUBS,
    ...LIGUE_1_CLUBS,
    ...WORLD_CUP_NATIONS,
  ];
  for (const name of allTeams) {
    tags.push({ slug: toSlug(name), name: name, kind: "TEAM" });
  }

  return tags;
}

// Adds missing tags and fixes changed ones, matching by slug.
// It reads the table once and writes in bulk, because one query per tag
// (about 150 round trips to Neon) took over 10 seconds.
export async function seedTags(): Promise<number> {
  const wanted = buildTagList();

  // slug -> the tag as it is in the database now
  const existing = await prisma.tag.findMany();
  const existingBySlug = new Map<string, SeedTag>();
  for (const tag of existing) {
    existingBySlug.set(tag.slug, tag);
  }

  const toCreate: SeedTag[] = [];
  const toUpdate: SeedTag[] = [];
  for (const tag of wanted) {
    const current = existingBySlug.get(tag.slug);
    if (!current) {
      toCreate.push(tag);
    } else if (current.name !== tag.name || current.kind !== tag.kind) {
      toUpdate.push(tag);
    }
  }

  if (toCreate.length > 0) {
    // skipDuplicates: if another run created the same slug a moment ago, skip it.
    await prisma.tag.createMany({ data: toCreate, skipDuplicates: true });
  }
  for (const tag of toUpdate) {
    await prisma.tag.update({
      where: { slug: tag.slug },
      data: { name: tag.name, kind: tag.kind },
    });
  }

  return wanted.length;
}

// Only runs when this file is started directly (bun prisma/seed.ts),
// not when a test imports seedTags from it.
if (import.meta.main) {
  const count = await seedTags();
  console.log(`Seeded ${count} tags.`);
  await prisma.$disconnect();
}
