/**
 * Arkade Settings → Network: mainnet / mutinynet + optional custom ASP.
 * Apply requires confirm; then prefs persist and the app remounts (soft restart).
 */

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { remountAppForNetworkSwitch } from "../runtime/remountApp";
import { ScreenChrome } from "../components/ScreenChrome";
import type { ArkadeNetworkId } from "../config/network";
import {
  defaultArkServerUrl,
  loadNetworkPreferences,
  normalizeArkServerUrl,
  writeNetworkPrefs,
  type NetworkPrefs,
} from "../config/networkPrefs";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

const NETWORKS: { id: ArkadeNetworkId; label: string; hint: string }[] = [
  { id: "mainnet", label: "Bitcoin mainnet", hint: "Real BTC · arkade.computer" },
  { id: "mutinynet", label: "Mutinynet", hint: "Test coins · mutinynet.arkade.sh" },
];

export function ArkadeNetworkScreen() {
  const [prefs, setPrefs] = useState<NetworkPrefs | null>(null);
  const [draftServer, setDraftServer] = useState("");
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const p = await loadNetworkPreferences();
        setPrefs(p);
        setDraftServer(p.customArkServer[p.networkId] ?? "");
      })();
    }, []),
  );

  const selectNetwork = (id: ArkadeNetworkId) => {
    if (!prefs) return;
    setPrefs({ ...prefs, networkId: id });
    setDraftServer(prefs.customArkServer[id] ?? "");
  };

  const applyAndRestart = () => {
    if (!prefs) return;
    const trimmed = draftServer.trim();
    let customUrl: string | undefined;
    if (trimmed) {
      const norm = normalizeArkServerUrl(trimmed);
      if (!norm) {
        Alert.alert("Invalid server", "Enter a valid http(s) ASP URL.");
        return;
      }
      customUrl = norm;
    }

    const nextCustom = { ...prefs.customArkServer };
    if (customUrl) nextCustom[prefs.networkId] = customUrl;
    else delete nextCustom[prefs.networkId];

    const next: NetworkPrefs = {
      networkId: prefs.networkId,
      customArkServer: nextCustom,
    };

    const serverLine = customUrl ?? defaultArkServerUrl(next.networkId);
    const netLabel = next.networkId === "mainnet" ? "Bitcoin mainnet" : "Mutinynet";

    Alert.alert(
      "Switch network?",
      `${netLabel}\n${serverLine}\n\nThe app will restart. Wallets and activity stay on each network separately.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm and restart",
          style: next.networkId === "mutinynet" ? "destructive" : "default",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await writeNetworkPrefs(next);
                remountAppForNetworkSwitch();
              } catch (e) {
                setBusy(false);
                Alert.alert(
                  "Could not restart",
                  e instanceof Error ? e.message : "Unknown error",
                );
              }
            })();
          },
        },
      ],
    );
  };

  if (!prefs) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ActivityIndicator color={colors.fg} style={{ marginTop: 40 }} />
      </ScreenChrome>
    );
  }

  const defaultUrl = defaultArkServerUrl(prefs.networkId);

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={ui.title}>NETWORK</Text>
        <Text style={ui.caption}>
          Choose Arkade network and optional custom ASP.{"\n"}
          Confirm to save and restart the app.
        </Text>

        <Text style={styles.section}>Network</Text>
        {NETWORKS.map((n) => {
          const selected = prefs.networkId === n.id;
          return (
            <Pressable
              key={n.id}
              style={[styles.choice, selected && styles.choiceOn]}
              onPress={() => selectNetwork(n.id)}
            >
              <Text style={[styles.choiceLabel, selected && styles.choiceLabelOn]}>
                {n.label}
              </Text>
              <Text style={styles.choiceHint}>{n.hint}</Text>
            </Pressable>
          );
        })}

        <Text style={[styles.section, { marginTop: 28 }]}>ASP server</Text>
        <Text style={styles.meta}>Default · {defaultUrl}</Text>
        <TextInput
          style={styles.input}
          value={draftServer}
          onChangeText={setDraftServer}
          placeholder={defaultUrl}
          placeholderTextColor={colors.hint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!busy}
        />
        <Text style={styles.meta}>
          Leave empty to use the official server for this network.
        </Text>
        {draftServer.trim() ? (
          <Pressable
            style={[ui.secondaryBtn, { marginTop: 12 }]}
            disabled={busy}
            onPress={() => setDraftServer("")}
          >
            <Text style={ui.secondaryBtnText}>Use default server</Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[ui.primaryBtn, { marginTop: 28 }, busy && { opacity: 0.5 }]}
          disabled={busy}
          onPress={applyAndRestart}
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={ui.primaryBtnText}>Apply and restart</Text>
          )}
        </Pressable>

        <Text style={[ui.hint, { marginTop: 20 }]}>
          Each network has its own wallets and encrypted local DB.{"\n"}
          Switching does not move funds between networks.
        </Text>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  section: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
    marginTop: 20,
    marginBottom: 10,
  },
  choice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  choiceOn: {
    borderColor: colors.fg,
  },
  choiceLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.caption,
  },
  choiceLabelOn: {
    color: colors.fg,
  },
  choiceHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginTop: 4,
  },
  meta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginBottom: 8,
    lineHeight: 16,
  },
  input: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: 10,
    marginBottom: 8,
  },
});
