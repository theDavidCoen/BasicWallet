/**
 * LNDHub connect body for InteractiveBottomSheet (LNbits extension QR / paste).
 */

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { getNetworkConfig } from "../config/network";
import { insertLightningWalletRow } from "../account/lightningActivity";
import {
  looksLikeLndHubUri,
  parseLndHubUri,
  probeLndHub,
} from "../lightning/lndhub";
import { saveLndHubCredentials } from "../lightning/lndhubCredentials";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";
import { ScanQrModal } from "./ScanQrModal";
import type { NodeStatusPayload } from "../navigation/connectFlow";

type Props = {
  open: boolean;
  onConnected: (payload: NodeStatusPayload) => void;
};

export function ConnectLndHubSheetContent({ open, onConnected }: Props) {
  const { selectWallet, refreshWalletList } = useWallet();
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPayload("");
    setBusy(false);
    setScanOpen(false);
  }, [open]);

  const connectWithRaw = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        Alert.alert("Missing URL", "Paste or scan an LNDHub connection URL.");
        return;
      }
      setBusy(true);
      try {
        const cfg = parseLndHubUri(trimmed);
        if (!cfg) {
          throw new Error(
            "Unrecognized URL. Expected lndhub://admin:…@https://…/lndhub/ext/",
          );
        }
        const { alias, balance } = await probeLndHub(cfg);

        const networkId = getNetworkConfig().id;
        const label = alias || cfg.hostLabel || "Lightning";
        const row = insertLightningWalletRow(networkId, label, "LNDHub");

        await saveLndHubCredentials({
          ...cfg,
          walletId: row.id,
          savedAt: Date.now(),
          alias,
        });

        setPayload("");
        void Clipboard.setStringAsync("").catch(() => {});

        refreshWalletList();
        await selectWallet(row.id);

        onConnected({
          localSats: balance.availableSats,
          alias,
        });
      } catch (e) {
        Alert.alert(
          "Could not connect",
          e instanceof Error ? e.message : "Unknown error",
        );
      } finally {
        setBusy(false);
      }
    },
    [onConnected, refreshWalletList, selectWallet],
  );

  const onPasteClipboard = useCallback(async () => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      Alert.alert("Clipboard empty", "Copy the LNDHub URL first.");
      return;
    }
    setPayload(text);
    void Clipboard.setStringAsync("").catch(() => {});
  }, []);

  return (
    <>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
        style={{ flex: 1 }}
      >
        <Text style={ui.title}>LNDHUB</Text>
        <Text style={ui.caption}>
          Scan the admin or invoice QR from your LNbits LndHub extension,{"\n"}
          or paste the connection URL.
        </Text>

        <Text style={styles.fieldLabel}>connection URL</Text>
        <TextInput
          value={payload}
          onChangeText={setPayload}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          placeholder="Paste lndhub://… URL"
          placeholderTextColor={colors.hint}
          style={[styles.input, styles.inputMulti]}
          editable={!busy}
          textContentType="none"
          autoComplete="off"
          importantForAutofill="no"
        />

        <Pressable
          style={ui.secondaryBtn}
          disabled={busy}
          onPress={() => void onPasteClipboard()}
        >
          <Text style={ui.secondaryBtnText}>Paste from clipboard</Text>
        </Pressable>

        <Pressable
          style={ui.secondaryBtn}
          disabled={busy}
          onPress={() => setScanOpen(true)}
        >
          <Text style={ui.secondaryBtnText}>Scan pairing QR</Text>
        </Pressable>

        <Pressable
          style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void connectWithRaw(payload)}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={ui.primaryBtnText}>Connect LNDHub</Text>
          )}
        </Pressable>

        <Text style={[ui.hint, { marginTop: 20 }]}>
          Prefer the admin URL for send + receive.{"\n"}
          Connection secrets stay on this device.
        </Text>
      </ScrollView>

      <ScanQrModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        title="SCAN"
        idleHint="Point at LNDHub QR"
        rejectHint="Not an LNDHub URL"
        parse={(raw) => {
          if (!looksLikeLndHubUri(raw)) return null;
          try {
            return parseLndHubUri(raw) ? raw.trim() : null;
          } catch {
            return null;
          }
        }}
        onScan={(value) => {
          void connectWithRaw(value);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 20,
    marginBottom: 6,
  },
  input: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  inputMulti: {
    minHeight: 100,
    textAlignVertical: "top",
  },
});
