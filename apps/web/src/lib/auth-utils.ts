const RESERVED_USERNAMES = [
  "admin",
  "var",
  "varroom",
  "deleted",
  "moderator",
  "support",
  "api",
  "system",
];

const USERNAME_REGEX = /^[A-Za-z0-9_]+$/;

export function isEmail(input: string): boolean {
  if (!input || !input.includes("@")) return false;
  const parts = input.split("@");
  if (parts.length !== 2) return false;
  const user = parts[0];
  const domain = parts[1];
  return Boolean(user && user.length > 0 && domain && domain.includes("."));
}

export function validateUsername(username: string): string | null {
  if (!username || username.length < 3 || username.length > 20) {
    return "Username must be between 3 and 20 characters.";
  }
  if (!USERNAME_REGEX.test(username)) {
    return "Usernames can only contain letters, numbers, and underscores.";
  }
  if (RESERVED_USERNAMES.includes(username.toLowerCase())) {
    return "This username is reserved.";
  }
  return null;
}

export function cleanDisplayName(name: string): string | null {
  const trimmed = (name || "").trim();
  if (trimmed.length < 1 || trimmed.length > 50) {
    return null;
  }
  return trimmed;
}

export function validatePassword(password: string): string | null {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (password.length > 128) {
    return "Password must be at most 128 characters.";
  }
  return null;
}

export function suggestUsername(displayName: string): string {
  if (!displayName) return "";
  let slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug.length > 20) {
    slug = slug.slice(0, 20).replace(/_+$/, "");
  }
  return slug;
}

export function normalizeAuthError(err: unknown): string {
  if (!err) {
    return "An unexpected error occurred. Please try again.";
  }

  if (typeof err === "object" && err !== null) {
    const record = err as Record<string, any>;
    if (record.status === 401) {
      return "Invalid email/username or password. Double check your credentials.";
    }
    if (record.error && typeof record.error === "object" && record.error.message) {
      return record.error.message;
    }
    if (record.message && typeof record.message === "string") {
      return record.message;
    }
  }

  if (typeof err === "string") {
    return err;
  }

  return "An unexpected error occurred. Please try again.";
}
