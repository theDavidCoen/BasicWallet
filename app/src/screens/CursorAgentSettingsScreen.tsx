/**
 * Settings → Cursor agent.
 * Collects only the user's Cursor API key. Shopping MCPs (e.g. Bitrefill) stay
 * on the user's Cursor Cloud / Dashboard — never asked for here.
 */

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, TextField } from "../components/ui";
import { activateCursorBot, disableCursorBot } from "../agent/activateBot";
import { readBotMeta } from "../agent/botIdentity";
import { midEllipsis } from "../nostr/keys";
import { hasNostrIdentity } from "../nostr/identityStore";
import { validateCursorApiKey } from "../agent/cursorCloud";
import {
  loadCursorAgentCredentials,
  maskCursorApiKey,
  saveCursorAgentCredentials,
} from "../settings/cursorAgentCredentials";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

const CURSOR_DASHBOARD_KEYS = "https://cursor.com/dashboard?tab=integrations";
const CURSOR_API_KEYS_HINT = "https://cursor.com/dashboard";

export function CursorAgentSettingsScreen() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasIdentity, setHasIdentity] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [botNpub, setBotNpub] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);

  const reload = useCallback(() => {
    void (async () => {
      setHasIdentity(await hasNostrIdentity());
      const creds = await loadCursorAgentCredentials();
      if (creds?.apiKey) {
        setSavedMask(maskCursorApiKey(creds.apiKey));
        setSavedEmail(creds.userEmail ?? creds.apiKeyName ?? null);
      } else {
        setSavedMask(null);
        setSavedEmail(null);
      }
      const meta = await readBotMeta();
      setEnabled(meta?.enabled === true);
      setBotNpub(meta?.botNpub ?? null);
      setReady(true);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  async function onSave() {
    if (busy) return;
    const key = draftKey.trim();
    if (!key) {
      Alert.alert(t("cursor.alertEmptyTitle"), t("cursor.alertEmptyBody"));
      return;
    }
    if (!(await hasNostrIdentity())) {
      Alert.alert(
        t("cursor.alertNeedNostrTitle"),
        t("cursor.alertNeedNostrBody"),
      );
      return;
    }
    setBusy(true);
    try {
      const me = await validateCursorApiKey(key);
      await saveCursorAgentCredentials({
        apiKey: key,
        apiKeyName: me.apiKeyName ?? null,
        userEmail: me.userEmail ?? null,
      });
      const act = await activateCursorBot();
      setDraftKey("");
      setSavedMask(maskCursorApiKey(key));
      setSavedEmail(me.userEmail ?? me.apiKeyName ?? null);
      setBotNpub(act.botNpub);
      setEnabled(true);
      Alert.alert(
        t("cursor.alertActiveTitle"),
        t("cursor.alertActiveBody"),
      );
    } catch (e) {
      Alert.alert(t("cursor.saveFailed"), e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  }

  function onDisable() {
    Alert.alert(
      t("cursor.disableTitle"),
      t("cursor.disableBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("cursor.disableWipe"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await disableCursorBot({ wipeIdentity: true, clearApiKey: true });
                setSavedMask(null);
                setSavedEmail(null);
                setBotNpub(null);
                setEnabled(false);
                setDraftKey("");
              } catch (e) {
                Alert.alert(
                  t("cursor.disableFailed"),
                  e instanceof Error ? e.message : t("common.unknownError"),
                );
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  async function copyBotNpub() {
    if (!botNpub) return;
    await Clipboard.setStringAsync(botNpub);
    Alert.alert(t("cursor.copiedTitle"), t("cursor.copiedBody"));
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={ui.title}>{t("cursor.title")}</Text>
        <Text style={ui.caption}>{t("cursor.caption")}</Text>

        {!ready ? (
          <ActivityIndicator color={colors.fg} style={{ marginTop: 24 }} />
        ) : (
          <>
            {!hasIdentity ? (
              <Text style={styles.warn}>{t("cursor.needIdentity")}</Text>
            ) : null}

            {savedMask ? (
              <View style={styles.statusCard}>
                <Text style={styles.statusLabel}>
                  {enabled ? t("cursor.active") : t("cursor.keySaved")}
                </Text>
                <Text style={styles.statusValue}>{savedMask}</Text>
                {savedEmail ? (
                  <Text style={styles.statusSub}>{savedEmail}</Text>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>{t("cursor.apiKey")}</Text>
            <TextField
              value={draftKey}
              onChangeText={setDraftKey}
              placeholder={savedMask ? t("cursor.phReplace") : t("cursor.phPaste")}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!busy}
            />

            <Button
              busy={busy}
              onPress={() => void onSave()}
              accessibilityLabel={t("cursor.saveA11y")}
            >
              {savedMask ? t("cursor.saveUpdate") : t("cursor.saveActivate")}
            </Button>

            <Pressable
              style={styles.linkBtn}
              onPress={() => void Linking.openURL(CURSOR_API_KEYS_HINT)}
            >
              <Text style={styles.linkText}>
                {t("cursor.openDashboard")}
              </Text>
            </Pressable>
            <Pressable
              style={styles.linkBtn}
              onPress={() => void Linking.openURL(CURSOR_DASHBOARD_KEYS)}
            >
              <Text style={styles.linkText}>
                {t("cursor.configureMcps")}
              </Text>
            </Pressable>

            {botNpub ? (
              <View style={styles.botCard}>
                <Text style={styles.fieldLabel}>{t("cursor.botNpub")}</Text>
                <Pressable onPress={() => void copyBotNpub()}>
                  <Text style={styles.botNpub}>{midEllipsis(botNpub, 16, 10)}</Text>
                  <Text style={styles.statusSub}>{t("cursor.botCopyHint")}</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.note}>{t("cursor.note")}</Text>

            {enabled || savedMask ? (
              <Pressable
                style={[styles.dangerBtn, busy && styles.disabled]}
                onPress={onDisable}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t("cursor.disableA11y")}
              >
                <Text style={styles.dangerText}>
                  {t("cursor.disableWipe")}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  warn: {
    marginTop: 16,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: "#E07070",
    lineHeight: 20,
  },
  statusCard: {
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  statusLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 4,
  },
  statusValue: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  statusSub: {
    marginTop: 6,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    lineHeight: 18,
  },
  fieldLabel: {
    marginTop: 20,
    marginBottom: 8,
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.caption,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    marginBottom: 14,
  },
  disabled: { opacity: 0.5 },
  linkBtn: { marginTop: 14 },
  linkText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textDecorationLine: "underline",
  },
  botCard: {
    marginTop: 24,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  botNpub: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
  },
  note: {
    marginTop: 20,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    lineHeight: 18,
  },
  dangerBtn: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E07070",
    alignItems: "center",
  },
  dangerText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: "#E07070",
  },
});
