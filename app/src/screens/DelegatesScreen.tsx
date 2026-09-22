/**
 * Penpot Delegates — enable Arkade default or custom delegator URL.
 */

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenChrome } from "../components/ScreenChrome";
import { getNetworkConfig } from "../config/network";
import {
  DEFAULT_DELEGATE_URL,
  normalizeDelegateUrl,
  patchDelegateSettings,
  probeDelegateInfo,
  readDelegateSettings,
  resolveDelegateUrl,
  type DelegateSettings,
} from "../arkade/delegateSettings";
import { clearOpenWallet } from "../wallet/hdWallet";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function DelegatesScreen() {
  const network = getNetworkConfig();
  const { selectWallet, selectedWallet } = useWallet();
  const [settings, setSettings] = useState<DelegateSettings | null>(null);
  const [customDraft, setCustomDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [probeLine, setProbeLine] = useState<string | null>(null);

  const reload = useCallback(() => {
    void (async () => {
      const s = await readDelegateSettings();
      setSettings(s);
      setCustomDraft(s.customUrl);
      const url = resolveDelegateUrl(network.id, s);
      if (!url) {
        setProbeLine(null);
        return;
      }
      try {
        const info = await probeDelegateInfo(url);
        setProbeLine(`ok · fee ${info.fee} sats · ${info.address.slice(0, 18)}…`);
      } catch (e) {
        setProbeLine(e instanceof Error ? e.message : "unreachable");
      }
    })();
  }, [network.id]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const applyAndReopen = useCallback(
    async (next: DelegateSettings) => {
      setBusy(true);
      try {
        await patchDelegateSettings(next);
        setSettings(next);
        clearOpenWallet();
        if (selectedWallet?.kind === "arkade") {
          await selectWallet(selectedWallet.id);
        }
        const url = resolveDelegateUrl(network.id, next);
        if (url) {
          try {
            const info = await probeDelegateInfo(url);
            setProbeLine(`ok · fee ${info.fee} sats · ${info.address.slice(0, 18)}…`);
          } catch (e) {
            setProbeLine(e instanceof Error ? e.message : "unreachable");
          }
        } else {
          setProbeLine(null);
        }
      } catch (e) {
        Alert.alert(
          "Could not apply",
          e instanceof Error ? e.message : "Unknown error",
        );
      } finally {
        setBusy(false);
      }
    },
    [network.id, selectWallet, selectedWallet],
  );

  if (!settings) {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={ui.title}>DELEGATES</Text>
        <ActivityIndicator color={colors.fg} style={{ marginTop: 24 }} />
      </ScreenChrome>
    );
  }

  const defaultUrl = DEFAULT_DELEGATE_URL[network.id];

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Text style={ui.title}>DELEGATES</Text>
        <Text style={ui.caption}>
          A delegate helps renew expiring VTXOs.{"\n"}
          Default is the Arkade network delegator.
        </Text>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Use delegate</Text>
            <Text style={styles.hint}>Off = renew locally when possible</Text>
          </View>
          <Switch
            value={settings.enabled}
            disabled={busy}
            onValueChange={(v) => void applyAndReopen({ ...settings, enabled: v })}
            trackColor={{ false: colors.border, true: colors.fg }}
            thumbColor="#000"
          />
        </View>

        {settings.enabled ? (
          <>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>Arkade default</Text>
                <Text style={styles.hint} numberOfLines={2}>
                  {defaultUrl}
                </Text>
              </View>
              <Switch
                value={settings.useDefault}
                disabled={busy}
                onValueChange={(v) =>
                  void applyAndReopen({ ...settings, useDefault: v })
                }
                trackColor={{ false: colors.border, true: colors.fg }}
                thumbColor="#000"
              />
            </View>

            {!settings.useDefault ? (
              <>
                <Text style={styles.fieldLabel}>custom server</Text>
                <TextInput
                  value={customDraft}
                  onChangeText={setCustomDraft}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="https://delegate.example.com"
                  placeholderTextColor={colors.hint}
                  style={styles.input}
                  editable={!busy}
                />
                <Pressable
                  style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
                  disabled={busy}
                  onPress={() => {
                    const url = normalizeDelegateUrl(customDraft);
                    if (!url) {
                      Alert.alert("Invalid URL", "Enter a valid http(s) host.");
                      return;
                    }
                    void applyAndReopen({
                      ...settings,
                      useDefault: false,
                      customUrl: url,
                    });
                  }}
                >
                  {busy ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={ui.primaryBtnText}>Save custom server</Text>
                  )}
                </Pressable>
              </>
            ) : null}

            {probeLine ? (
              <Text style={[ui.hint, { marginTop: 20 }]}>{probeLine}</Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  rowText: { flex: 1 },
  label: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: colors.fg,
  },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 4,
  },
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
    marginBottom: 12,
  },
});
