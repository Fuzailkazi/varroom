import { describe, expect, it } from "bun:test";

describe("View mapping and feed filtering logic", () => {
  interface DebateItem {
    id: string;
    statement: string;
    decision: "OVERTURNED" | "DECISION_STANDS" | "CHECK_INCOMPLETE" | "LIVE";
    score: number | null;
  }

  function mapDebateToFeedItem(item: any): DebateItem {
    const review = item.latestReview;
    let decision: DebateItem["decision"] = "CHECK_INCOMPLETE";
    if (review) {
      if (review.status === "RUNNING" || review.status === "PENDING") {
        decision = "LIVE";
      } else if (review.decision === "OVERTURNED") {
        decision = "OVERTURNED";
      } else if (review.decision === "CONFIRMED" || review.decision === "UPHELD") {
        decision = "DECISION_STANDS";
      }
    }
    return {
      id: item.id,
      statement: item.thesis || item.title,
      decision,
      score: review ? review.credibilityScore : null,
    };
  }

  function filterFeed(
    items: DebateItem[],
    filter: "all" | "overturned" | "stands" | "incomplete",
  ): DebateItem[] {
    return items.filter((item) => {
      if (filter === "all") return true;
      if (filter === "overturned") return item.decision === "OVERTURNED";
      if (filter === "stands") return item.decision === "DECISION_STANDS";
      if (filter === "incomplete")
        return item.decision === "CHECK_INCOMPLETE" || item.decision === "LIVE";
      return true;
    });
  }

  it("correctly maps debate items based on review status and decision", () => {
    const sampleDebates = [
      {
        id: "d1",
        title: "Bellingham as an 8",
        latestReview: { status: "COMPLETE", decision: "OVERTURNED", credibilityScore: 24 },
      },
      {
        id: "d2",
        title: "Arsenal corner routines",
        latestReview: { status: "COMPLETE", decision: "CONFIRMED", credibilityScore: 92 },
      },
      {
        id: "d3",
        title: "Haaland touches per 90",
        latestReview: { status: "RUNNING", decision: null, credibilityScore: null },
      },
      {
        id: "d4",
        title: "Unreviewed take",
        latestReview: null,
      },
    ];

    const mapped = sampleDebates.map(mapDebateToFeedItem);
    const [m0, m1, m2, m3] = mapped;
    expect(m0?.decision).toBe("OVERTURNED");
    expect(m0?.score).toBe(24);
    expect(m1?.decision).toBe("DECISION_STANDS");
    expect(m1?.score).toBe(92);
    expect(m2?.decision).toBe("LIVE");
    expect(m2?.score).toBeNull();
    expect(m3?.decision).toBe("CHECK_INCOMPLETE");
    expect(m3?.score).toBeNull();
  });

  it("filters community feed by decision categories", () => {
    const items: DebateItem[] = [
      { id: "1", statement: "Take 1", decision: "OVERTURNED", score: 20 },
      { id: "2", statement: "Take 2", decision: "DECISION_STANDS", score: 85 },
      { id: "3", statement: "Take 3", decision: "CHECK_INCOMPLETE", score: 50 },
      { id: "4", statement: "Take 4", decision: "LIVE", score: null },
    ];

    expect(filterFeed(items, "all").length).toBe(4);
    expect(filterFeed(items, "overturned").map((i) => i.id)).toEqual(["1"]);
    expect(filterFeed(items, "stands").map((i) => i.id)).toEqual(["2"]);
    expect(filterFeed(items, "incomplete").map((i) => i.id)).toEqual(["3", "4"]);
  });
});
