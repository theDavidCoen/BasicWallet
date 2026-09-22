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
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getMnemonicSource } from "../wallet/mnemonicMeta";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { AddEntropyPanel } from "./AddEntropyPanel";

const CAPTION_PASSKEY =
  "Create Wallet derives a labeled child from your passkey PRF proof. " +
  "The same label + passkey always rematerializes this wallet. " +
  "On a fresh install, sign in with your passkey to recover it.";

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
        <Text style={styles.title}>ADD WALLET</Text>
        <Text style={styles.caption}>{CAPTION_DEVICE}</Text>
        <Pressable style={styles.primary} onPress={() => setDeviceStep("entropy")}>
          <Text style={styles.primaryText}>Continue</Text>
        </Pressable>
        <Pressable style={ui.secondaryBtn} onPress={onImportWallet}>
          <Text style={ui.secondaryBtnText}>Import Wallet</Text>
        </Pressable>
      </View>
    );
  }

  // Passkey: name + create. Device after entropy: name + create.
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{passkeyRoot ? "ADD WALLET" : "NAME WALLET"}</Text>
      <Text style={styles.caption}>
        {passkeyRoot
          ? CAPTION_PASSKEY
          : "Label this wallet, then create it with CSPRNG strengthened by your motion."}
      </Text>

      <Text style={styles.fieldLabel}>NAME WALLET</Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="Savings"
        placeholderTextColor={colors.hint}
        autoCapitalize="words"
        editable={!busy}
      />

      <Pressable
        style={[styles.primary, busy && { opacity: 0.6 }]}
        disabled={busy}
        onPress={() => void (passkeyRoot ? onCreatePasskey() : onCreateDevice())}
      >
        {busy ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.primaryText}>Create Wallet</Text>
        )}
      </Pressable>

      {passkeyRoot ? (
        <Pressable style={ui.secondaryBtn} disabled={busy} onPress={onImportWallet}>
          <Text style={ui.secondaryBtnText}>Import Wallet</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 4,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 24,
    lineHeight: 18,
  },
  fieldLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
    color: colors.fg,
  },
  primary: {
    marginTop: 24,
    borderRadius: 10,
    backgroundColor: colors.fg,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.bg,
  },
});
