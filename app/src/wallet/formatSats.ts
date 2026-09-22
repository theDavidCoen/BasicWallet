/** Format wallet balance for UI; respects session privacy mask. */
export function formatSatsLabel(
  sats: number | null,
  hidden: boolean,
  empty = "…",
): string {
  if (sats === null) return empty;
  if (hidden) return "****** sats";
  return `${sats.toLocaleString("en-US")} sats`;
}

export function formatSatsAmount(sats: number, hidden: boolean): string {
  if (hidden) return "******";
  return sats.toLocaleString("en-US");
}
