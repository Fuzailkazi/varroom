import { describe, expect, it } from "bun:test";

describe("ScoreGauge segment logic", () => {
  function calculateSegments(score: number): number {
    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    return clamped > 0 ? Math.max(1, Math.floor(clamped / 5)) : 0;
  }

  function getClassification(score: number): string {
    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    if (clamped >= 80) return "DECISION SUPPORTED";
    if (clamped >= 50) return "INCONCLUSIVE";
    return "CONTRADICTED";
  }

  it("calculates zero segments when score is 0", () => {
    expect(calculateSegments(0)).toBe(0);
    expect(getClassification(0)).toBe("CONTRADICTED");
  });

  it("illuminates at least 1 segment for non-zero scores below 5", () => {
    expect(calculateSegments(1)).toBe(1);
    expect(calculateSegments(4)).toBe(1);
    expect(getClassification(4)).toBe("CONTRADICTED");
  });

  it("stays strictly in the red zone at score 49", () => {
    expect(calculateSegments(49)).toBe(9);
    expect(getClassification(49)).toBe("CONTRADICTED");
  });

  it("enters the amber zone at score 50", () => {
    expect(calculateSegments(50)).toBe(10);
    expect(getClassification(50)).toBe("INCONCLUSIVE");
  });

  it("enters the supported green zone at score 80", () => {
    expect(calculateSegments(80)).toBe(16);
    expect(getClassification(80)).toBe("DECISION SUPPORTED");
  });

  it("illuminates all 20 segments at score 100", () => {
    expect(calculateSegments(100)).toBe(20);
    expect(getClassification(100)).toBe("DECISION SUPPORTED");
  });

  it("clamps scores outside boundary", () => {
    expect(calculateSegments(-10)).toBe(0);
    expect(calculateSegments(150)).toBe(20);
  });
});
