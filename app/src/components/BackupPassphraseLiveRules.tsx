/**
 * Live passphrase rule rows for Path C enable (Nostr / Home Server).
 */

import { StyleSheet, Text, View } from "react-native";
import {
  backupPassphraseChecklist,
  type BackupPassphraseChecklist,
} from "../nostr/passphrasePolicy";
import { colors } from "../theme/colors";

type Props = {
  passphrase: string;
  confirm: string;
  /** When false, hide the match row (rare). Default true. */
  showMatch?: boolean;
};

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Text style={[styles.row, ok ? styles.ok : styles.pending]}>
      {ok ? "✓" : "○"} {label}
    </Text>
  );
}

export function BackupPassphraseLiveRules({
  passphrase,
  confirm,
  showMatch = true,
}: Props) {
  const c: BackupPassphraseChecklist = backupPassphraseChecklist(
    passphrase,
    showMatch ? confirm : undefined,
  );
  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Row ok={c.minLength} label="At least 12 characters" />
      <Row ok={c.hasLetter} label="At least 1 letter" />
      <Row ok={c.hasDigit} label="At least 1 number" />
      <Row ok={c.hasSpecial} label="At least 1 ASCII special (including .)" />
      {showMatch ? (
        <Row ok={c.matchesConfirm} label="Passphrase and confirmation match" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    gap: 4,
  },
  row: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    lineHeight: 18,
  },
  ok: { color: colors.fg },
  pending: { color: colors.hint },
});
