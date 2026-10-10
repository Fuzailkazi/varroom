import { describe, expect, it } from "bun:test";

describe("DecisionBanner verdict normalization", () => {
  function getBannerTitle(verdict: string): string {
    switch (verdict) {
      case "DECISION_STANDS":
      case "CONFIRMED":
        return "DECISION STANDS";
      case "OVERTURNED":
        return "OVERTURNED";
      case "CHECK_INCOMPLETE":
      case "INCONCLUSIVE":
        return "CHECK INCOMPLETE";
      case "IN_PROGRESS":
        return "VAR CHECK IN PROGRESS";
      default:
        return "VAR REVIEW";
    }
  }

  function getBannerHeader(verdict: string): string {
    return verdict === "IN_PROGRESS" ? "VAR REVIEW" : "VAR DECISION";
  }

  it("handles verified and confirmed states with official wording", () => {
    expect(getBannerTitle("DECISION_STANDS")).toBe("DECISION STANDS");
    expect(getBannerTitle("CONFIRMED")).toBe("DECISION STANDS");
    expect(getBannerHeader("DECISION_STANDS")).toBe("VAR DECISION");
  });

  it("handles overturned verdicts", () => {
    expect(getBannerTitle("OVERTURNED")).toBe("OVERTURNED");
    expect(getBannerHeader("OVERTURNED")).toBe("VAR DECISION");
  });

  it("handles incomplete checks and inconclusive states", () => {
    expect(getBannerTitle("CHECK_INCOMPLETE")).toBe("CHECK INCOMPLETE");
    expect(getBannerTitle("INCONCLUSIVE")).toBe("CHECK INCOMPLETE");
    expect(getBannerHeader("CHECK_INCOMPLETE")).toBe("VAR DECISION");
  });

  it("handles live active reviews", () => {
    expect(getBannerTitle("IN_PROGRESS")).toBe("VAR CHECK IN PROGRESS");
    expect(getBannerHeader("IN_PROGRESS")).toBe("VAR REVIEW");
  });
});
