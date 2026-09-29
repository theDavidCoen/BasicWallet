/**
 * Home bottom sheet: enter backup passphrase into ephemeral session only.
 * Legacy path for backupPassphraseNeededAfterPair (pre-α41 pair without
 * transferred passphrase). Happy-path BLE pair persists the passphrase and
 * does not open this sheet.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { InteractiveBottomSheet } from "./sheet/InteractiveBottomSheet";
import { PassphraseInput } from "./PassphraseInput";
import {
  decryptPackage,
  readCipherBlob,
} from "../nostr/backupPackage";
import { loadNostrKeyPairForCrypto } from "../nostr/identityStore";
import {
  clearBackupPassphraseNeededAfterPair,
  scheduleEncryptedBackupSync,
  setSessionBackupPassphrase,
} from "../nostr/backupSync";
import { colors } from "../theme/colors";
import { sheetUi } from "../theme/sheetUi";

export function BackupPassphraseSheet({
  open,
  onDismiss,
  onArmed,
}: {
  open: boolean;
  onDismiss: () => void;
  /** Called after session passphrase is accepted (banner should hide). */
  onArmed: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

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
      }
      // Ephemeral only — never persistBackupPassphrase.
      setSessionBackupPassphrase(value);
      await clearBackupPassphraseNeededAfterPair();
      setPassphrase("");
      onArmed();
      onDismiss();
      scheduleEncryptedBackupSync("pair-passphrase-session", 2_000);
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
        <Text style={sheetUi.title}>Backup passphrase</Text>
        <Text style={sheetUi.caption}>
          Backup is already set up on this wallet. Enter the passphrase to reactivate
          encrypted uploads on this device. It stays in memory only for this session —
          Basic never stores it on disk.
        </Text>

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

        <Pressable
          style={[sheetUi.primaryBtn, busy ? styles.btnDisabled : null]}
          onPress={() => {
            if (!busy) void onConfirm();
          }}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Confirm backup passphrase"
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={sheetUi.primaryBtnText}>Confirm</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.secondaryBtn, busy ? styles.btnDisabled : null]}
          onPress={onDismiss}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={sheetUi.secondaryBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </InteractiveBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: 8,
  },
  secondaryBtn: {
    ...sheetUi.secondaryBtn,
    backgroundColor: "#000",
  },
  btnDisabled: {
    opacity: 0.55,
  },
});
