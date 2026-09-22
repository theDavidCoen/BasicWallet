/** Map noisy native/network errors to short user-facing copy. */
export function friendlyNetworkError(err: unknown, fallback = "Network error — try again"): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.toLowerCase();
  if (
    m.includes("software caused connection abort") ||
    m.includes("connection abort") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("network request failed") ||
    m.includes("failed to fetch") ||
    m.includes("socket") ||
    m.includes("closed before")
  ) {
    return fallback;
  }
  if (!raw.trim()) return fallback;
  // Keep short SDK messages; truncate huge stacks.
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}
