/**
 * Backup passphrase policy (Path C Nostr / home server).
 * Applied when setting a passphrase; decrypt only needs a non-empty string.
 *
 * KDF uses 50k PBKDF2 iters (mobile-friendly). Security then depends on
 * passphrase entropy — UI must steer users to a password-manager random string.
 */

const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /[0-9]/;
/** ASCII punctuation / symbols, including period. */
const HAS_SPECIAL = /[!-/:-@[-`{-~]/;

/** Hard floor for enable (existing packages may be shorter on restore). */
export const BACKUP_PASSPHRASE_RULES =
  "Minimum 12 characters, with 1 letter, 1 number,\nand 1 ASCII special (including .).";

/** Shown under the rules on enable screens. */
export const BACKUP_PASSPHRASE_HINT =
  "Recommended: generate ~20+ random characters in a password manager and paste here. Do not use a short or memorable phrase.";

export function validateBackupPassphrase(
  raw: string,
): { ok: true; passphrase: string } | { ok: false; message: string } {
  const passphrase = raw; // do not trim away intentional spaces mid-string; only reject empty ends for UX
  const value = passphrase;
  if (value.length < 12) {
    return { ok: false, message: "Passphrase must be at least 12 characters." };
  }
  if (!HAS_LETTER.test(value)) {
    return { ok: false, message: "Passphrase must include at least one letter." };
  }
  if (!HAS_DIGIT.test(value)) {
    return { ok: false, message: "Passphrase must include at least one number." };
  }
  if (!HAS_SPECIAL.test(value)) {
    return {
      ok: false,
      message: "Passphrase must include at least one ASCII special character (including .).",
    };
  }
  return { ok: true, passphrase: value };
}
