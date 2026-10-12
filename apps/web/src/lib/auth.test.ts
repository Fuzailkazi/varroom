import { describe, expect, test } from "bun:test";
import {
  cleanDisplayName,
  isEmail,
  normalizeAuthError,
  suggestUsername,
  validatePassword,
  validateUsername,
} from "./auth-utils";

describe("auth validation utilities", () => {
  describe("isEmail", () => {
    test("identifies standard email addresses", () => {
      expect(isEmail("pundit@varroom.dev")).toBe(true);
      expect(isEmail("jude.fan@madrid.es")).toBe(true);
    });

    test("rejects usernames without an @ symbol", () => {
      expect(isEmail("jude_fan")).toBe(false);
      expect(isEmail("arsenal_ref")).toBe(false);
      expect(isEmail("")).toBe(false);
    });
  });

  describe("validateUsername", () => {
    test("accepts valid alphanumeric and underscored usernames", () => {
      expect(validateUsername("jude_fan")).toBeNull();
      expect(validateUsername("Pundit99")).toBeNull();
      expect(validateUsername("var_referee_1")).toBeNull();
    });

    test("rejects usernames shorter than 3 characters", () => {
      expect(validateUsername("ab")).toBe("Username must be between 3 and 20 characters.");
    });

    test("rejects usernames longer than 20 characters", () => {
      expect(validateUsername("a".repeat(21))).toBe(
        "Username must be between 3 and 20 characters.",
      );
    });

    test("rejects invalid characters (spaces, dashes, symbols)", () => {
      expect(validateUsername("jude fan")).toBe(
        "Usernames can only contain letters, numbers, and underscores.",
      );
      expect(validateUsername("jude-fan")).toBe(
        "Usernames can only contain letters, numbers, and underscores.",
      );
      expect(validateUsername("jude@fan")).toBe(
        "Usernames can only contain letters, numbers, and underscores.",
      );
    });

    test("rejects reserved usernames case-insensitively", () => {
      expect(validateUsername("admin")).toBe("This username is reserved.");
      expect(validateUsername("Admin")).toBe("This username is reserved.");
      expect(validateUsername("VAR")).toBe("This username is reserved.");
      expect(validateUsername("varroom")).toBe("This username is reserved.");
      expect(validateUsername("moderator")).toBe("This username is reserved.");
    });
  });

  describe("cleanDisplayName", () => {
    test("trims extra whitespace from valid names", () => {
      expect(cleanDisplayName("  Jude Bellingham  ")).toBe("Jude Bellingham");
    });

    test("returns null for empty or whitespace-only names", () => {
      expect(cleanDisplayName("   ")).toBeNull();
      expect(cleanDisplayName("")).toBeNull();
    });

    test("returns null for names exceeding 50 characters", () => {
      expect(cleanDisplayName("x".repeat(51))).toBeNull();
    });
  });

  describe("validatePassword", () => {
    test("accepts passwords within the 8 to 128 character window", () => {
      expect(validatePassword("password123")).toBeNull();
      expect(validatePassword("p".repeat(128))).toBeNull();
    });

    test("rejects passwords shorter than 8 characters", () => {
      expect(validatePassword("short7!")).toBe("Password must be at least 8 characters long.");
    });

    test("rejects passwords longer than 128 characters", () => {
      expect(validatePassword("p".repeat(129))).toBe("Password must be at most 128 characters.");
    });
  });

  describe("suggestUsername", () => {
    test("converts human names to clean lowercase underscored slugs", () => {
      expect(suggestUsername("Jude Bellingham")).toBe("jude_bellingham");
      expect(suggestUsername("Pep Guardiola")).toBe("pep_guardiola");
    });

    test("strips special symbols and trims leading/trailing underscores", () => {
      expect(suggestUsername("Mikel Arteta (Arsenal)")).toBe("mikel_arteta_arsenal");
    });

    test("clamps length to 20 characters", () => {
      const longName = "A Very Long Pundit Name Here";
      const slug = suggestUsername(longName);
      expect(slug.length).toBeLessThanOrEqual(20);
    });
  });

  describe("normalizeAuthError", () => {
    test("normalizes custom Express error shape", () => {
      const err = { error: { code: "EMAIL_NOT_VERIFIED", message: "Confirm your email." } };
      expect(normalizeAuthError(err)).toBe("Confirm your email.");
    });

    test("normalizes Better Auth error shape", () => {
      const err = { code: "INVALID_CREDENTIALS", message: "Invalid email or password" };
      expect(normalizeAuthError(err)).toBe("Invalid email or password");
    });

    test("provides generic security error for 401 unauthenticated", () => {
      expect(normalizeAuthError({ status: 401 })).toBe(
        "Invalid email/username or password. Double check your credentials.",
      );
    });

    test("falls back gracefully for unknown errors", () => {
      expect(normalizeAuthError(null)).toBe("An unexpected error occurred. Please try again.");
    });
  });
});
