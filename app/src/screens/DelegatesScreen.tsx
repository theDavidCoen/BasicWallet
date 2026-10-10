/**
 * Penpot Delegates — enable Arkade default or custom delegator URL.
 */

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, ScreenTitle, SettingsRow } from "../components/ui";
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
import { useI18n } from "../i18n";
import { clearOpenWallet } from "../wallet/hdWallet";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

export function DelegatesScreen() {
  const { t } = useI18n();
  const network = getNetworkConfig();
  const { selectWallet, selectedWallet } = useWallet();
  const [settings, setSettings] = useState<DelegateSettings | null>(null);
  const [customDraft, setCustomDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [probeLine, setProbeLine] = useState<string | null>(null);

  const formatProbe = useCallback(
    (info: { fee: number; address: string }) =>
      t("arkade.probeOk", { fee: info.fee, addr: info.address.slice(0, 18) }),
    [t],
  );

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
        setProbeLine(formatProbe(info));
      } catch (e) {
        setProbeLine(e instanceof Error ? e.message : t("arkade.unreachable"));
      }
    })();
  }, [formatProbe, network.id, t]);

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
            setProbeLine(formatProbe(info));
          } catch (e) {
            setProbeLine(e instanceof Error ? e.message : t("arkade.unreachable"));
          }
        } else {
          setProbeLine(null);
        }
      } catch (e) {
        Alert.alert(
          t("arkade.applyFailed"),
          e instanceof Error ? e.message : t("common.unknownError"),
        );
      } finally {
        setBusy(false);
      }
    },
    [formatProbe, network.id, selectWallet, selectedWallet, t],
  );

  if (!settings) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ScreenTitle>{t("arkade.delegatesTitle")}</ScreenTitle>
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
        <ScreenTitle>{t("arkade.delegatesTitle")}</ScreenTitle>
        <Caption>{t("arkade.delegatesCaption")}</Caption>

        <SettingsRow
          label={t("arkade.useDelegate")}
          hint={t("arkade.useDelegateHint")}
          disabled={busy}
          onPress={() => void applyAndReopen({ ...settings, enabled: !settings.enabled })}
          right={
            <Switch
              value={settings.enabled}
              disabled={busy}
              onValueChange={(v) => void applyAndReopen({ ...settings, enabled: v })}
              trackColor={{ false: colors.border, true: colors.fg }}
              thumbColor={colors.onPrimary}
            />
          }
        />

        {settings.enabled ? (
          <>
            <SettingsRow
              label={t("arkade.arkadeDefault")}
              hint={defaultUrl}
              disabled={busy}
              onPress={() =>
                void applyAndReopen({ ...settings, useDefault: !settings.useDefault })
              }
              right={
                <Switch
                  value={settings.useDefault}
                  disabled={busy}
                  onValueChange={(v) =>
                    void applyAndReopen({ ...settings, useDefault: v })
                  }
                  trackColor={{ false: colors.border, true: colors.fg }}
                  thumbColor={colors.onPrimary}
                />
              }
            />

            {!settings.useDefault ? (
              <>
                <Text style={styles.fieldLabel}>{t("arkade.customServer")}</Text>
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
                <Button
                  busy={busy}
                  onPress={() => {
                    const url = normalizeDelegateUrl(customDraft);
                    if (!url) {
                      Alert.alert(t("arkade.invalidUrlTitle"), t("arkade.invalidUrlBody"));
                      return;
                    }
                    void applyAndReopen({
                      ...settings,
                      useDefault: false,
                      customUrl: url,
                    });
                  }}
                >
                  {t("arkade.saveCustom")}
                </Button>
              </>
            ) : null}

            {probeLine ? (
              <Text style={styles.probeHint}>{probeLine}</Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  probeHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 20,
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
