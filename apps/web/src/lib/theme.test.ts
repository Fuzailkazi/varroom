import { describe, expect, it } from "bun:test";

describe("Theme resolution logic", () => {
  function resolveTheme(
    theme: "dark" | "light" | "system",
    systemPrefersDark: boolean
  ): "dark" | "light" {
    if (theme === "system") {
      return systemPrefersDark ? "dark" : "light";
    }
    return theme;
  }

  function getStoredThemeOrDefault(storedValue: string | null): "dark" | "light" | "system" {
    if (storedValue === "light" || storedValue === "dark" || storedValue === "system") {
      return storedValue;
    }
    return "dark"; // Default to dark VAR booth
  }

  it("defaults to dark mode when no storage key exists", () => {
    expect(getStoredThemeOrDefault(null)).toBe("dark");
  });

  it("honors saved theme preferences", () => {
    expect(getStoredThemeOrDefault("light")).toBe("light");
    expect(getStoredThemeOrDefault("dark")).toBe("dark");
    expect(getStoredThemeOrDefault("system")).toBe("system");
  });

  it("resolves system mode based on operating system query", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("resolves explicit themes regardless of system query", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
