export function sanitizeReturnTo(url: string | null | undefined): string {
  if (!url || typeof url !== "string") {
    return "/";
  }

  const trimmed = url.trim();

  // Must start with a single slash and NOT double slash or protocol
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }

  // Reject javascript: or data: or other protocol indicators
  if (/^(\/|)+[a-z0-9]+:/i.test(trimmed)) {
    return "/";
  }

  return trimmed;
}
