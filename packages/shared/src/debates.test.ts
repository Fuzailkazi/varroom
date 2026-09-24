import { describe, expect, test } from "bun:test";
import { CreateDebateRequest, Debate, ListDebatesQuery, ListTagsQuery } from "./debates.ts";

// schema tests, no db. checks how bodies/queries get cleaned and validated

// valid body, tests override one field at a time
function validBody() {
  return {
    title: "Bellingham is better as a 9",
    thesis: "He arrives in the box late and wins more headers than any other midfielder.",
    categories: ["TACTICAL"],
  };
}

// issue paths as dotted strings, ["tags", 2] -> "tags.2"
function issuePaths(result: ReturnType<typeof CreateDebateRequest.safeParse>): string[] {
  const paths: string[] = [];
  if (result.success) {
    return paths;
  }
  for (const issue of result.error.issues) {
    paths.push(issue.path.join("."));
  }
  return paths;
}

describe("CreateDebateRequest", () => {
  test("accepts a valid body and fills tags with an empty list", () => {
    const result = CreateDebateRequest.safeParse(validBody());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  test("trims the title and turns line breaks into spaces", () => {
    const result = CreateDebateRequest.parse({ ...validBody(), title: "  Arsenal should\r\nsign a striker  " });
    expect(result.title).toBe("Arsenal should sign a striker");
  });

  test("trims the thesis", () => {
    const result = CreateDebateRequest.parse({ ...validBody(), thesis: "   They create plenty of chances but finish too few of them.   " });
    expect(result.thesis).toBe("They create plenty of chances but finish too few of them.");
  });

  test("counts the title length after cleaning: 9 characters is too short", () => {
    const tooShort = CreateDebateRequest.safeParse({ ...validBody(), title: "Too short" });
    expect(tooShort.success).toBe(false);
    expect(issuePaths(tooShort)).toEqual(["title"]);

    // "Exactly 10" is 10 chars after trim
    const justEnough = CreateDebateRequest.safeParse({ ...validBody(), title: "  Exactly 10  " });
    expect(justEnough.success).toBe(true);
  });

  test("refuses a title over 120 and a thesis over 1000 characters", () => {
    const longTitle = CreateDebateRequest.safeParse({ ...validBody(), title: "a".repeat(121) });
    expect(issuePaths(longTitle)).toEqual(["title"]);

    const longThesis = CreateDebateRequest.safeParse({ ...validBody(), thesis: "b".repeat(1001) });
    expect(issuePaths(longThesis)).toEqual(["thesis"]);
  });

  test("a thesis of only spaces fails on the thesis field", () => {
    const result = CreateDebateRequest.safeParse({ ...validBody(), thesis: " ".repeat(40) });
    expect(issuePaths(result)).toEqual(["thesis"]);
  });

  test("uppercases categories and removes repeats before counting", () => {
    const result = CreateDebateRequest.parse({
      ...validBody(),
      categories: ["tactical", "TACTICAL", "Player", "PLAYER", "other", "TRANSFER"],
    });
    expect(result.categories).toEqual(["TACTICAL", "PLAYER", "OTHER", "TRANSFER"]);
  });

  test("refuses no categories and more than 4 categories", () => {
    const none = CreateDebateRequest.safeParse({ ...validBody(), categories: [] });
    expect(issuePaths(none)).toEqual(["categories"]);

    // 5 distinct values, dedupe won't save it
    const five = CreateDebateRequest.safeParse({ ...validBody(), categories: ["TACTICAL", "TRANSFER", "PLAYER", "OTHER", "GOSSIP"] });
    expect(five.success).toBe(false);
    expect(issuePaths(five)[0]?.startsWith("categories")).toBe(true);
  });

  test("names the position of an unknown category", () => {
    const result = CreateDebateRequest.safeParse({ ...validBody(), categories: ["TACTICAL", "GOSSIP"] });
    expect(issuePaths(result)).toEqual(["categories.1"]);
  });

  test("lowercases and trims tag slugs and removes repeats", () => {
    const result = CreateDebateRequest.parse({ ...validBody(), tags: ["Arsenal", " arsenal ", "CHELSEA"] });
    expect(result.tags).toEqual(["arsenal", "chelsea"]);
  });

  test("refuses more than 5 tags", () => {
    const result = CreateDebateRequest.safeParse({ ...validBody(), tags: ["a", "b", "c", "d", "e", "f"] });
    expect(issuePaths(result)).toEqual(["tags"]);
  });

  test("ignores unknown fields such as focusPlayerId", () => {
    const result = CreateDebateRequest.parse({ ...validBody(), focusPlayerId: 12345 });
    expect("focusPlayerId" in result).toBe(false);
  });

  test("a missing title or a non string title fails on title", () => {
    const missing = CreateDebateRequest.safeParse({ thesis: validBody().thesis, categories: ["OTHER"] });
    expect(issuePaths(missing)).toEqual(["title"]);

    const number = CreateDebateRequest.safeParse({ ...validBody(), title: 42 });
    expect(issuePaths(number)).toEqual(["title"]);
  });

  test("reports every bad field at once", () => {
    const result = CreateDebateRequest.safeParse({ title: "short", thesis: "x", categories: [] });
    expect(issuePaths(result).sort()).toEqual(["categories", "thesis", "title"]);
  });
});

describe("ListDebatesQuery", () => {
  test("an empty query gives the defaults: sort new, limit 20", () => {
    const result = ListDebatesQuery.parse({});
    expect(result.sort).toBe("new");
    expect(result.limit).toBe(20);
    expect(result.cursor).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  test("accepts sort, category and kind in any letter case", () => {
    const result = ListDebatesQuery.parse({ sort: " TOP ", category: "transfer", author: "JUDE_FAN", tag: " Arsenal " });
    expect(result.sort).toBe("top");
    expect(result.category).toBe("TRANSFER");
    expect(result.author).toBe("jude_fan"); // stored lowercase
    expect(result.tag).toBe("arsenal");
  });

  test("limit comes in as text and is turned into a number", () => {
    expect(ListDebatesQuery.parse({ limit: "50" }).limit).toBe(50);
    expect(ListDebatesQuery.parse({ limit: "1" }).limit).toBe(1);
  });

  test("refuses a bad sort, a limit outside 1 to 50, and an unknown category", () => {
    const bad = ["sort=hot", "limit=0", "limit=51", "limit=abc", "limit=2.5", "category=gossip"];
    for (const pair of bad) {
      const [key, value] = pair.split("=");
      const result = ListDebatesQuery.safeParse({ [key!]: value });
      expect(result.success).toBe(false);
    }
  });

  test("passes the cursor through untouched, the route checks it", () => {
    const result = ListDebatesQuery.parse({ cursor: "not-a-uuid" });
    expect(result.cursor).toBe("not-a-uuid");
  });
});

describe("ListTagsQuery", () => {
  test("kind is optional and accepts any letter case", () => {
    expect(ListTagsQuery.parse({}).kind).toBeUndefined();
    expect(ListTagsQuery.parse({ kind: "team" }).kind).toBe("TEAM");
    expect(ListTagsQuery.parse({ kind: "League" }).kind).toBe("LEAGUE");
  });

  test("refuses an unknown kind", () => {
    expect(ListTagsQuery.safeParse({ kind: "club" }).success).toBe(false);
  });
});

describe("Debate response shape", () => {
  const debate = {
    id: "280c06dd-a9f8-41a7-9151-d348a6a7e295",
    title: "Arsenal need a striker now",
    thesis: "They create enough chances but miss too many of them.",
    categories: ["TRANSFER"],
    tags: [{ slug: "arsenal", name: "Arsenal", kind: "TEAM" }],
    author: { username: null, displayUsername: null, displayName: "deleted user", badge: null },
    createdAt: "2026-09-24T16:11:35.946Z",
    upVotes: 0,
    downVotes: 0,
    voteScore: 0,
    commentCount: 0,
    credibilityScore: null,
    latestReview: null,
    myVote: null,
  };

  test("accepts a debate with a deleted author and no review", () => {
    expect(Debate.safeParse(debate).success).toBe(true);
  });

  test("myVote is only 1, -1 or null", () => {
    expect(Debate.safeParse({ ...debate, myVote: 1 }).success).toBe(true);
    expect(Debate.safeParse({ ...debate, myVote: -1 }).success).toBe(true);
    expect(Debate.safeParse({ ...debate, myVote: 2 }).success).toBe(false);
  });

  test("createdAt must be an ISO date string", () => {
    expect(Debate.safeParse({ ...debate, createdAt: "yesterday" }).success).toBe(false);
  });
});
