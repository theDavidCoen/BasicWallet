/**
 * Add Wallet body for InteractiveBottomSheet.
 * Passkey installs: name + Create (PRF child).
 * Device-only: intro → 14b ADD ENTROPY → name + Create (CSPRNG ⊕ motion).
 */

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, Caption, ScreenTitle, TextField } from "../components/ui";
import { getMnemonicSource } from "../wallet/mnemonicMeta";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { sheetUi } from "../theme/sheetUi";
import { AddEntropyPanel } from "./AddEntropyPanel";

const CAPTION_PASSKEY =
  "Create Wallet derives a named child from your passkey (stable index). " +
  "After a fresh install, Continue with passkey rematerializes every active child; " +
  "names come back from the automatic Nostr label directory. " +
  "Removed wallets stay archived under Settings → Account.";

const CAPTION_DEVICE =
  "Create Wallet makes a new wallet on this device using the strongest " +
  "cryptography the OS provides. Motion entropy strengthens that randomness. " +
  "Use one of the backup methods " +
  "(seed export, Nostr package, or home server) or it cannot be recovered " +
  "after a fresh install.";

type Props = {
  open: boolean;
  onDone: () => void;
  onImportWallet: () => void;
  /** OS back at the top of this flow (e.g. return to Wallets list). */
  onExitFlow?: () => void;
};

type DeviceStep = "intro" | "entropy" | "name";

export function AddWalletSheetContent({
  open,
  onDone,
  onImportWallet,
  onExitFlow,
}: Props) {
  const { createExtraArkadeWallet } = useWallet();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyRoot, setPasskeyRoot] = useState<boolean | null>(null);
  const [deviceStep, setDeviceStep] = useState<DeviceStep>("intro");
  const [motionDigest, setMotionDigest] = useState<Uint8Array | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLabel("");
    setMotionDigest(null);
    setDeviceStep("intro");
    setBusy(false);
    void (async () => {
      const s = await getMnemonicSource();
      if (!cancelled) setPasskeyRoot(s === "passkey-prf");
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // System back: device sub-steps first, then exit to parent flow (Wallets list).
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (passkeyRoot === false) {
        if (deviceStep === "name") {
          setDeviceStep("entropy");
          return true;
        }
        if (deviceStep === "entropy") {
          setDeviceStep("intro");
          return true;
        }
      }
      if (onExitFlow) {
        onExitFlow();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [open, passkeyRoot, deviceStep, onExitFlow]);

  async function onCreatePasskey() {
    const name = label.trim() || "Savings";
    setBusy(true);
    try {
      await createExtraArkadeWallet(name, { mode: "passkey" });
      onDone();
    } catch (e) {
      Alert.alert("Could not create wallet", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateDevice() {
    if (!motionDigest) {
      Alert.alert("Entropy required", "Add motion entropy before creating the wallet.");
      setDeviceStep("entropy");
      return;
    }
    const name = label.trim() || "Savings";
    setBusy(true);
    try {
      await createExtraArkadeWallet(name, {
        mode: "csprng",
        motionDigest32: motionDigest,
      });
      onDone();
    } catch (e) {
      Alert.alert("Could not create wallet", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  if (passkeyRoot === null) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.fg} />
      </View>
    );
  }

  if (!passkeyRoot && deviceStep === "entropy") {
    return (
      <AddEntropyPanel
        onComplete={(digest) => {
          setMotionDigest(digest);
          setDeviceStep("name");
        }}
      />
    );
  }

  if (!passkeyRoot && deviceStep === "intro") {
    return (
      <View style={styles.root}>
        <ScreenTitle style={sheetUi.title}>ADD WALLET</ScreenTitle>
        <Caption style={sheetUi.caption}>{CAPTION_DEVICE}</Caption>
        <Button size="sheet" onPress={() => setDeviceStep("entropy")}>
          Continue
        </Button>
        <Button size="sheet" variant="secondary" onPress={onImportWallet}>
          Import Wallet
        </Button>
      </View>
    );
  }

  // Passkey: name + create. Device after entropy: name + create.
  return (
    <View style={styles.root}>
      <ScreenTitle style={sheetUi.title}>
        {passkeyRoot ? "ADD WALLET" : "NAME WALLET"}
      </ScreenTitle>
      <Caption style={sheetUi.caption}>
        {passkeyRoot
          ? CAPTION_PASSKEY
          : "Label this wallet, then create it with CSPRNG strengthened by your motion."}
      </Caption>

      <Text style={sheetUi.label}>NAME WALLET</Text>
      <TextField
        value={label}
        onChangeText={setLabel}
        placeholder="Savings"
        autoCapitalize="words"
        editable={!busy}
      />

      <Button
        size="sheet"
        busy={busy}
        onPress={() => void (passkeyRoot ? onCreatePasskey() : onCreateDevice())}
      >
        Create Wallet
      </Button>

      {passkeyRoot ? (
        <Button size="sheet" variant="secondary" disabled={busy} onPress={onImportWallet}>
          Import Wallet
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
});
