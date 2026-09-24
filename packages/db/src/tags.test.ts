import { describe, expect, test } from "bun:test";
import { sortTags } from "./tags.ts";

// sortTags is pure, so plain unit tests. leagues first, then teams, a-z

describe("sortTags", () => {
  test("puts leagues before teams, each sorted by name", () => {
    const sorted = sortTags([
      { name: "Chelsea", kind: "TEAM" },
      { name: "Serie A", kind: "LEAGUE" },
      { name: "Arsenal", kind: "TEAM" },
      { name: "Bundesliga", kind: "LEAGUE" },
    ]);
    expect(sorted.map((tag) => tag.name)).toEqual(["Bundesliga", "Serie A", "Arsenal", "Chelsea"]);
  });

  test("keeps the other fields on each tag", () => {
    const sorted = sortTags([{ slug: "arsenal", name: "Arsenal", kind: "TEAM" as const, id: 7 }]);
    expect(sorted[0]).toEqual({ slug: "arsenal", name: "Arsenal", kind: "TEAM", id: 7 });
  });

  test("handles an empty list and a list of one kind", () => {
    expect(sortTags([])).toEqual([]);
    const onlyTeams = sortTags([
      { name: "Lyon", kind: "TEAM" },
      { name: "Lens", kind: "TEAM" },
    ]);
    expect(onlyTeams.map((tag) => tag.name)).toEqual(["Lens", "Lyon"]);
  });

  test("does not change the list it was given", () => {
    const original = [
      { name: "Chelsea", kind: "TEAM" as const },
      { name: "La Liga", kind: "LEAGUE" as const },
    ];
    sortTags(original);
    expect(original[0]?.name).toBe("Chelsea");
  });
});
