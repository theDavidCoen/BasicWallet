/**
 * Bottom sheet: enter backup AEAD passphrase.
 *
 * Modes:
 * - session (default): legacy Home banner after pair re-arm without transfer.
 *   Sets RAM session only (does not write SecureStore).
 * - pair: Device 1 Approve when backup meta is ON but SecureStore is empty.
 *   Verifies cipher, persistBackupPassphrase, then continues pairing.
 */

import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { InteractiveBottomSheet } from "./sheet/InteractiveBottomSheet";
import { Button, Caption, ScreenTitle } from "./ui";
import { PassphraseInput } from "./PassphraseInput";
import {
  decryptPackage,
  readCipherBlob,
} from "../nostr/backupPackage";
import { loadNostrKeyPairForCrypto } from "../nostr/identityStore";
import {
  clearBackupPassphraseNeededAfterPair,
  persistBackupPassphrase,
  scheduleEncryptedBackupSync,
  setSessionBackupPassphrase,
} from "../nostr/backupSync";
import { sheetUi } from "../theme/sheetUi";

export type BackupPassphraseSheetMode = "session" | "pair";

export function BackupPassphraseSheet({
  open,
  onDismiss,
  onArmed,
  mode = "session",
}: {
  open: boolean;
  onDismiss: () => void;
  /** Called after passphrase is accepted (banner hide / pair continue). */
  onArmed: (passphrase: string) => void;
  mode?: BackupPassphraseSheetMode;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const pairMode = mode === "pair";

  useEffect(() => {
    if (!open) {
      setPassphrase("");
      setBusy(false);
    }
  }, [open]);

  async function onConfirm() {
    const value = passphrase;
    if (!value.trim()) {
      Alert.alert("Passphrase needed", "Enter your backup passphrase to continue.");
      return;
    }
    setBusy(true);
    try {
      const pair = await loadNostrKeyPairForCrypto();
      if (!pair?.nsec) {
        throw new Error("Nostr identity missing on this device.");
      }
      const blob = await readCipherBlob();
      if (blob?.saltHex && blob.ciphertextHex) {
        try {
          await decryptPackage(blob, pair.nsec, value);
        } catch {
          Alert.alert(
            "Wrong passphrase",
            "That passphrase does not unlock the backup package.",
          );
          return;
        }
      } else if (pairMode) {
        // Pair needs a real cipher to transfer; refuse empty/corrupt local package.
        Alert.alert(
          "Backup package missing",
          "Cloud backup is marked on, but no encrypted package was found on this device.",
        );
        return;
      }

      if (pairMode) {
        await persistBackupPassphrase(value);
      } else {
        // Ephemeral only — never persistBackupPassphrase (legacy banner path).
        setSessionBackupPassphrase(value);
        await clearBackupPassphraseNeededAfterPair();
      }

      setPassphrase("");
      onArmed(value.trim());
      onDismiss();
      if (!pairMode) {
        scheduleEncryptedBackupSync("pair-passphrase-session", 2_000);
      }
    } catch (e) {
      Alert.alert(
        "Could not unlock backup",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <InteractiveBottomSheet
      open={open}
      onDismiss={onDismiss}
      visibleFraction={0.48}
      avoidKeyboard
      portal
    >
      <View style={styles.body}>
        <ScreenTitle style={sheetUi.title}>Backup passphrase</ScreenTitle>
        <Caption style={sheetUi.caption}>
          {pairMode
            ? "Cloud backup is on, but this phone does not have the passphrase stored. Enter it once to continue pairing — Basic saves it securely and sends it to the other phone."
            : "Backup is already set up on this wallet. Enter the passphrase to reactivate encrypted uploads on this device. It stays in memory only for this session — Basic never stores it on disk."}
        </Caption>

        <Text style={sheetUi.label}>Passphrase</Text>
        <PassphraseInput
          value={passphrase}
          onChangeText={setPassphrase}
          placeholder="Backup passphrase"
          editable={!busy}
          autoFocus={open}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!busy) void onConfirm();
          }}
        />

        <Button
          size="sheet"
          busy={busy}
          onPress={() => {
            if (!busy) void onConfirm();
          }}
          accessibilityLabel="Confirm backup passphrase"
        >
          Confirm
        </Button>

        <Button
          size="sheet"
          variant="secondary"
          style={styles.secondaryBtn}
          disabled={busy}
          onPress={onDismiss}
          accessibilityLabel="Cancel"
        >
          Cancel
        </Button>
      </View>
    </InteractiveBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: 8,
  },
  secondaryBtn: {
    backgroundColor: "#000",
  },
});
