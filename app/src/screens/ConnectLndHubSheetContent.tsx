/**
 * LNDHub connect body for InteractiveBottomSheet (LNbits extension QR / paste).
 */

import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import { Button, Caption, ScreenTitle, TextField } from "../components/ui";
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
import { sheetUi } from "../theme/sheetUi";
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
        <ScreenTitle style={sheetUi.title}>LNDHUB</ScreenTitle>
        <Caption style={sheetUi.caption}>
          {
            "Scan the admin or invoice QR from your LNbits LndHub extension,\nor paste the connection URL."
          }
        </Caption>

        <Text style={styles.fieldLabel}>connection URL</Text>
        <TextField
          value={payload}
          onChangeText={setPayload}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          placeholder="Paste lndhub://… URL"
          style={[styles.input, styles.inputMulti]}
          editable={!busy}
          textContentType="none"
          autoComplete="off"
          importantForAutofill="no"
        />

        <Button
          size="sheet"
          variant="secondary"
          disabled={busy}
          onPress={() => void onPasteClipboard()}
        >
          Paste from clipboard
        </Button>

        <Button
          size="sheet"
          variant="secondary"
          disabled={busy}
          onPress={() => setScanOpen(true)}
        >
          Scan pairing QR
        </Button>

        <Button size="sheet" busy={busy} onPress={() => void connectWithRaw(payload)}>
          Connect LNDHub
        </Button>

        <Text style={[sheetUi.hint, { marginTop: 20 }]}>
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
