/**
 * BTCPay LND (REST) connect body for InteractiveBottomSheet.
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
import {
  extractBtcPayConfigUrl,
  looksLikeBtcPayOrLndConfig,
  resolveBtcPayOrLndPayload,
} from "../lightning/btcpayConfig";
import { saveLndRestCredentials } from "../lightning/lndCredentials";
import { probeLndRest } from "../lightning/lndRest";
import { insertLightningWalletRow } from "../account/lightningActivity";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";
import { ScanQrModal } from "./ScanQrModal";
import type { NodeStatusPayload } from "../navigation/connectFlow";

type Props = {
  open: boolean;
  onConnected: (payload: NodeStatusPayload) => void;
};

export function ConnectBtcPaySheetContent({ open, onConnected }: Props) {
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
        Alert.alert("Missing config", "Paste or scan a BTCPay LND (REST) config.");
        return;
      }
      setBusy(true);
      try {
        const cfg = await resolveBtcPayOrLndPayload(trimmed);
        const { info, balance } = await probeLndRest(cfg);

        const networkId = getNetworkConfig().id;
        const alias = info.alias?.trim() || "Lightning";
        const row = insertLightningWalletRow(networkId, alias, "BTCPay");

        await saveLndRestCredentials({
          ...cfg,
          walletId: row.id,
          savedAt: Date.now(),
          alias: info.alias,
          identityPubkey: info.identity_pubkey,
        });

        setPayload("");
        void Clipboard.setStringAsync("").catch(() => {});

        refreshWalletList();
        await selectWallet(row.id);

        onConnected({
          localSats: balance.localSats,
          alias: info.alias ?? alias,
          pubkey: info.identity_pubkey,
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
      Alert.alert("Clipboard empty", "Copy the config from BTCPay first.");
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
        <Text style={ui.title}>BTCPAY</Text>
        <Text style={ui.caption}>
          BTCPay → Services → LND (REST).{"\n"}
          Scan the pairing QR or paste the config.
        </Text>

        <Text style={styles.fieldLabel}>config</Text>
        <TextInput
          value={payload}
          onChangeText={setPayload}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          placeholder="Paste config from BTCPay"
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
            <Text style={ui.primaryBtnText}>Connect BTCPay</Text>
          )}
        </Pressable>

        <Text style={[ui.hint, { marginTop: 20 }]}>
          Payments only — no channel management.{"\n"}
          Connection secrets stay on this device.
        </Text>
      </ScrollView>

      <ScanQrModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        title="SCAN"
        idleHint="Point at BTCPay LND (REST) QR"
        rejectHint="Not a BTCPay LND (REST) config"
        parse={(raw) => {
          if (!looksLikeBtcPayOrLndConfig(raw)) return null;
          return extractBtcPayConfigUrl(raw) ?? raw.trim();
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
    minHeight: 120,
    textAlignVertical: "top",
  },
});
