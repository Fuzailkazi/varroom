import { describe, expect, test } from "bun:test";
import { sanitizeReturnTo } from "./auth-navigation";

describe("auth navigation and returnTo security", () => {
  test("accepts safe relative paths for returnTo", () => {
    expect(sanitizeReturnTo("/review/8c4a4564")).toBe("/review/8c4a4564");
    expect(sanitizeReturnTo("/feed")).toBe("/feed");
    expect(sanitizeReturnTo("/")).toBe("/");
  });

  test("rejects external absolute URLs to prevent open redirect vulnerabilities", () => {
    expect(sanitizeReturnTo("https://malicious.com")).toBe("/");
    expect(sanitizeReturnTo("http://malicious.com")).toBe("/");
    expect(sanitizeReturnTo("//malicious.com")).toBe("/");
  });

  test("rejects javascript: schemes and non-string or empty inputs", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo(undefined)).toBe("/");
  });
});
