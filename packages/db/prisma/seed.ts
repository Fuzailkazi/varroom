import { prisma } from "../src/client.ts";

// seeds the tags table (leagues, clubs, national teams). `bun run db:seed`.
// idempotent - matches by slug so rerunning changes nothing.
// refresh the club lists each summer after promotion/relegation, old tags stay valid

const LEAGUES = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Champions League",
  "Europa League",
];

// top 5 leagues, 2026/27 season (wikipedia, checked 2026-09-24)
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

// 2026 world cup, all 48 teams
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

// name -> slug: "Atlético Madrid" -> "atletico-madrid", "Brighton & Hove Albion" -> "brighton-hove-albion"
export function toSlug(name: string): string {
  // NFD splits accented chars into base + accent mark, then we strip the marks
  const split = name.normalize("NFD");
  const noAccents = split.replace(/[̀-ͯ]/g, "");
  const lower = noAccents.toLowerCase();
  // non alphanumerics -> dash
  const dashed = lower.replace(/[^a-z0-9]+/g, "-");
  // trim leading/trailing dashes
  return dashed.replace(/^-+|-+$/g, "");
}

type SeedTag = {
  slug: string;
  name: string;
  kind: "TEAM" | "LEAGUE";
};

// leagues, then clubs, then nations
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

// inserts missing tags and updates changed ones by slug.
// one read + bulk write, because 150 upserts to neon took 10s+
export async function seedTags(): Promise<number> {
  const wanted = buildTagList();

  // slug -> current db row
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
    // skipDuplicates in case two seeds race
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

// only when run directly, not when tests import seedTags
if (import.meta.main) {
  const count = await seedTags();
  console.log(`Seeded ${count} tags.`);
  await prisma.$disconnect();
}
