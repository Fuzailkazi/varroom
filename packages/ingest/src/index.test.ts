import { expect, test } from "bun:test";
import { STATSBOMB_BASE_URL } from "./index.ts";

test("StatsBomb data is fetched over https", () => {
  expect(STATSBOMB_BASE_URL).toStartWith("https://");
});
