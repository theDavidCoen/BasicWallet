/**
 * Closed-app push config (Android).
 * Override with EXPO_PUBLIC_BASIC_NOTIFIER_URL / EXPO_PUBLIC_BASIC_NOTIFIER_KEY at build time.
 */

export const BASIC_APP_ID = "app.basic.wallet";

/** Public HTTPS base for the notifier sidecar (no trailing slash). */
export const NOTIFIER_BASE_URL = (
  process.env.EXPO_PUBLIC_BASIC_NOTIFIER_URL || "https://notifier.davidcoen.it"
).replace(/\/$/, "");

/**
 * Shared install secret — must match sidecar NOTIFIER_APP_KEY.
 * Empty in tree on purpose; set via EAS env / local .env for builds that register.
 */
export const NOTIFIER_APP_KEY =
  process.env.EXPO_PUBLIC_BASIC_NOTIFIER_KEY?.trim() || "";

/** Home relay the sidecar watches by default; also sent on register when present in backup meta. */
export const HOME_RELAY_HINT = "wss://relay.davidcoen.it";

export const OPAQUE_PUSH_TITLE = "Basic";
export const OPAQUE_PUSH_BODY = "New Pay message";

/** Android notification channel for Pay / Nostr wake. */
export const PAY_NOTIFICATION_CHANNEL_ID = "basic-pay";
