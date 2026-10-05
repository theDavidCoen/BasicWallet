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
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { ScreenChrome } from "../components/ScreenChrome";
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
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

const CURSOR_DASHBOARD_KEYS = "https://cursor.com/dashboard?tab=integrations";
const CURSOR_API_KEYS_HINT = "https://cursor.com/dashboard";

export function CursorAgentSettingsScreen() {
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
      Alert.alert("Cursor API key", "Paste your Cursor API key from the Dashboard.");
      return;
    }
    if (!(await hasNostrIdentity())) {
      Alert.alert(
        "Nostr identity required",
        "Create or import a Nostr identity first (Settings → Nostr identity).",
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
        "Cursor agent active",
        "Ask Cursor is ready in Chat & Pay. Shopping MCPs (e.g. Bitrefill) must already be configured on your Cursor Cloud / Dashboard.",
      );
    } catch (e) {
      Alert.alert("Save failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function onDisable() {
    Alert.alert(
      "Disable Cursor agent?",
      "Stops the bot watcher, removes Ask Cursor from Chat & Pay, and wipes the bot key and your Cursor API key from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disable & wipe",
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
                  "Disable failed",
                  e instanceof Error ? e.message : "Unknown error",
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
    Alert.alert("Copied", "Bot npub copied. Strangers messaging this npub are ignored.");
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={ui.title}>CURSOR AGENT</Text>
        <Text style={ui.caption}>
          Paste your Cursor API key to activate Ask Cursor in Chat & Pay. Bitrefill
          and other shopping MCPs stay on your Cursor Cloud / Dashboard — Basic never
          asks for those keys.
        </Text>

        {!ready ? (
          <ActivityIndicator color={colors.fg} style={{ marginTop: 24 }} />
        ) : (
          <>
            {!hasIdentity ? (
              <Text style={styles.warn}>
                Create a Nostr identity first (Settings → Nostr identity). Only that
                npub can talk to your bot.
              </Text>
            ) : null}

            {savedMask ? (
              <View style={styles.statusCard}>
                <Text style={styles.statusLabel}>
                  {enabled ? "Active" : "Key saved"}
                </Text>
                <Text style={styles.statusValue}>{savedMask}</Text>
                {savedEmail ? (
                  <Text style={styles.statusSub}>{savedEmail}</Text>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Cursor API key</Text>
            <TextInput
              value={draftKey}
              onChangeText={setDraftKey}
              placeholder={savedMask ? "Paste new key to replace…" : "Paste API key…"}
              placeholderTextColor={colors.hint}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!busy}
            />

            <Pressable
              style={[ui.primaryBtn, busy && styles.disabled]}
              onPress={() => void onSave()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Save Cursor API key and activate bot"
            >
              {busy ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>
                  {savedMask ? "Validate & update" : "Save & activate"}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.linkBtn}
              onPress={() => void Linking.openURL(CURSOR_API_KEYS_HINT)}
            >
              <Text style={styles.linkText}>Open Cursor Dashboard →</Text>
            </Pressable>
            <Pressable
              style={styles.linkBtn}
              onPress={() => void Linking.openURL(CURSOR_DASHBOARD_KEYS)}
            >
              <Text style={styles.linkText}>Configure Dashboard MCPs →</Text>
            </Pressable>

            {botNpub ? (
              <View style={styles.botCard}>
                <Text style={styles.fieldLabel}>Bot npub</Text>
                <Pressable onPress={() => void copyBotNpub()}>
                  <Text style={styles.botNpub}>{midEllipsis(botNpub, 16, 10)}</Text>
                  <Text style={styles.statusSub}>
                    Tap to copy. Only your activating npub can converse; others get
                    silence.
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.note}>
              You pay Cursor Cloud usage for agents started with your key. The bot
              replies while Basic is open or recently resumed (same family as chat).
            </Text>

            {enabled || savedMask ? (
              <Pressable
                style={[styles.dangerBtn, busy && styles.disabled]}
                onPress={onDisable}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Disable Cursor agent"
              >
                <Text style={styles.dangerText}>Disable & wipe</Text>
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
