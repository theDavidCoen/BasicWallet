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
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function ArkadeNetworkScreen() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<NetworkPrefs | null>(null);
  const [draftServer, setDraftServer] = useState("");
  const [busy, setBusy] = useState(false);

  const networks: { id: ArkadeNetworkId; label: string; hint: string }[] = [
    { id: "mainnet", label: t("arkade.mainnetLabel"), hint: t("arkade.mainnetHint") },
    { id: "mutinynet", label: t("arkade.mutinynetLabel"), hint: t("arkade.mutinynetHint") },
  ];

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
        Alert.alert(t("arkade.invalidServerTitle"), t("arkade.invalidServerBody"));
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
    const netLabel =
      next.networkId === "mainnet" ? t("arkade.mainnetLabel") : t("arkade.mutinynetLabel");

    Alert.alert(
      t("arkade.switchTitle"),
      t("arkade.switchBody", { net: netLabel, server: serverLine }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("arkade.confirmRestart"),
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
                  t("arkade.restartFailed"),
                  e instanceof Error ? e.message : t("common.unknownError"),
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
        <Text style={ui.title}>{t("arkade.networkTitle")}</Text>
        <Text style={ui.caption}>{t("arkade.networkCaption")}</Text>

        <Text style={styles.section}>{t("arkade.networkSection")}</Text>
        {networks.map((n) => {
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

        <Text style={[styles.section, { marginTop: 28 }]}>{t("arkade.aspSection")}</Text>
        <Text style={styles.meta}>{t("arkade.defaultServer", { url: defaultUrl })}</Text>
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
        <Text style={styles.meta}>{t("arkade.aspEmptyHint")}</Text>
        {draftServer.trim() ? (
          <Pressable
            style={[ui.secondaryBtn, { marginTop: 12 }]}
            disabled={busy}
            onPress={() => setDraftServer("")}
          >
            <Text style={ui.secondaryBtnText}>{t("arkade.useDefault")}</Text>
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
            <Text style={ui.primaryBtnText}>{t("arkade.applyRestart")}</Text>
          )}
        </Pressable>

        <Text style={[ui.hint, { marginTop: 20 }]}>{t("arkade.networkHint")}</Text>
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
