import { expect, spyOn, test } from "bun:test";
import { loadEnv } from "./env.ts";

test("parses a valid environment and defaults PORT", () => {
  const env = loadEnv({ DATABASE_URL: "postgresql://u:p@host/db" });
  expect(env.PORT).toBe(3000);
});

test("stops the process naming DATABASE_URL when it is missing", () => {
  const exit = spyOn(process, "exit").mockImplementation((() => {
    throw new Error("exit");
  }) as never);
  const error = spyOn(console, "error").mockImplementation(() => {});
  expect(() => loadEnv({})).toThrow("exit");
  expect(String(error.mock.calls[0]?.[0])).toContain("DATABASE_URL");
  exit.mockRestore();
  error.mockRestore();
});
