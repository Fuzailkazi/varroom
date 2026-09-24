import { expect, test } from "bun:test";
import { PIPELINE_STAGES } from "./index.ts";

test("pipeline runs moderator, then stats specialist, then fact checker", () => {
  expect(PIPELINE_STAGES).toEqual(["moderator", "stats_specialist", "fact_checker"]);
});
