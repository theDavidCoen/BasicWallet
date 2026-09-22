/**
 * WebAuthn relying party for passkeys.
 *
 * Must match a domain you control with:
 * - Android: /.well-known/assetlinks.json (incl. get_login_creds)
 * - iOS: /.well-known/apple-app-site-association + associatedDomains
 *
 * Live RP: https://basic.davidcoen.it/.well-known/assetlinks.json
 * Override at build time: EXPO_PUBLIC_PASSKEY_RP_ID
 */

export const PASSKEY_RP_ID =
  (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_PASSKEY_RP_ID) ||
  "basic.davidcoen.it";

export const PASSKEY_RP_NAME = "Basic";
