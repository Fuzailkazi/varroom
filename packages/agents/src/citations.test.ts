import { expect, test, describe } from "bun:test";
import { validateCitations } from "./citations.ts";
import type { EvidenceRecord } from "./citations.ts";

// evidence rows for claim 1 and claim 2
const ev: EvidenceRecord[] = [
  { label: "E1", args: { claimOrder: 1, query: "Bellingham as 9 stats" } },
  { label: "E2", args: { claimOrder: 1, query: "Bellingham as 9 stats" } },
  { label: "E3", args: { claimOrder: 2, query: "Bellingham as 8 stats" } },
];

describe("validateCitations", () => {
  test("valid labels for the right claim returns ok", () => {
    const result = validateCitations(["E1", "E2"], 1, ev);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validLabels).toEqual(["E1", "E2"]);
    }
  });

  test("label belonging to a different claim is invalid", () => {
    // E3 belongs to claim 2, not claim 1
    const result = validateCitations(["E1", "E3"], 1, ev);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidLabels).toEqual(["E3"]);
    }
  });

  test("nonexistent label is invalid", () => {
    const result = validateCitations(["E1", "E99"], 1, ev);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidLabels).toContain("E99");
    }
  });

  test("zero cited labels returns ok: false with empty invalidLabels", () => {
    const result = validateCitations([], 1, ev);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidLabels).toEqual([]);
    }
  });

  test("label from claim 2 validated against claim 2 is valid", () => {
    const result = validateCitations(["E3"], 2, ev);
    expect(result.ok).toBe(true);
  });

  test("a model borrowing all its citations from another claim is invalid", () => {
    // the model cited E3 (claim 2's evidence) for claim 1
    const result = validateCitations(["E3"], 1, ev);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidLabels).toEqual(["E3"]);
    }
  });

  test("empty evidence list means all labels are invalid", () => {
    const result = validateCitations(["E1"], 1, []);
    expect(result.ok).toBe(false);
  });
});
