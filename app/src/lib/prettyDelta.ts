/** Human duration from seconds (arkade.money `prettyDelta`, long form). */
export function prettyDelta(seconds: number, long = true): string {
  const delta = Math.abs(seconds);
  if (delta >= 86_400) {
    const days = Math.floor(delta / 86_400);
    return `${days}${long ? (days === 1 ? " day" : " days") : "d"}`;
  }
  if (delta >= 3_600) {
    const hours = Math.floor(delta / 3_600);
    return `${hours}${long ? (hours === 1 ? " hour" : " hours") : "h"}`;
  }
  if (delta >= 60) {
    const minutes = Math.floor(delta / 60);
    return `${minutes}${long ? (minutes === 1 ? " minute" : " minutes") : "m"}`;
  }
  if (delta > 0) {
    return `${delta}${long ? (delta === 1 ? " second" : " seconds") : "s"}`;
  }
  return "";
}
