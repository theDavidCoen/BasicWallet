import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { AdaptiveText, useI18n } from "../i18n";
import { clearAppPin, hasAppPin, setAppPin, validatePinFormat, verifyAppPin } from "../security/appPin";
import { getOsBiometricsStatus } from "../security/osBiometrics";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

type Mode = "create" | "confirm" | "change-old" | "change-new" | "change-confirm" | "remove";

/** Set / change / remove app unlock PIN (Privacy → App PIN). */
export function SetAppPinScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "SetAppPin">>();
  const { t } = useI18n();
  const intent = route.params?.intent ?? "set";
  const continueTo = route.params?.continueTo;
  const isOnboarding = intent === "onboarding";

  const [mode, setMode] = useState<Mode>(() => {
    if (intent === "remove") return "remove";
    if (intent === "change") return "change-old";
    return "create";
  });
  const [draft, setDraft] = useState("");
  const [first, setFirst] = useState("");
  const [busy, setBusy] = useState(false);

  const title = useMemo(() => {
    switch (mode) {
      case "confirm":
      case "change-confirm":
        return t("privacy.confirmPinTitle");
      case "change-old":
      case "remove":
        return t("privacy.enterCurrentPinTitle");
      case "change-new":
        return t("privacy.newPinTitle");
      default:
        return t("privacy.setPinTitle");
    }
  }, [mode, t]);

  const caption = useMemo(() => {
    switch (mode) {
      case "confirm":
      case "change-confirm":
        return t("privacy.captionConfirm");
      case "change-old":
        return t("privacy.captionChangeOld");
      case "remove":
        return t("privacy.captionRemove");
      case "change-new":
        return t("privacy.captionChangeNew");
      default:
        return isOnboarding
          ? t("privacy.captionOnboarding")
          : t("privacy.captionSet");
    }
  }, [mode, isOnboarding, t]);

  function invalidPinMessage(pin: string): string {
    if (!/^\d+$/.test(pin)) return t("privacy.alertPinDigitsOnly");
    return t("privacy.alertPinLength");
  }

  async function onDigit(d: string) {
    if (busy) return;
    const next = (draft + d).slice(0, 8);
    setDraft(next);
    if (next.length < 4) return;
    // Auto-advance only when user taps enough — wait for 4+ and they tap Done, or auto at 6?
    // Penpot uses 6 dots. We'll accept submit when length >= 4 via full row or auto at 6.
    if (next.length === 6) {
      await submit(next);
    }
  }

  function onDelete() {
    setDraft((p) => p.slice(0, -1));
  }

  async function submit(pin: string) {
    const check = validatePinFormat(pin);
    if (!check.ok) {
      Alert.alert(t("privacy.alertInvalidPinTitle"), invalidPinMessage(pin));
      setDraft("");
      return;
    }

    setBusy(true);
    try {
      if (mode === "create") {
        setFirst(pin);
        setDraft("");
        setMode("confirm");
        return;
      }
      if (mode === "confirm") {
        if (pin !== first) {
          Alert.alert(t("privacy.alertMismatchTitle"), t("privacy.alertMismatchBody"));
          setDraft("");
          setFirst("");
          setMode("create");
          return;
        }
        await setAppPin(pin);
        if (isOnboarding && continueTo) {
          if (continueTo === "restore") {
            navigation.replace("RestoreWallet", { mode: "full" });
          } else {
            navigation.replace("TermsOfUse", {
              mode: continueTo === "passkey" ? "passkey" : "device-only",
            });
          }
          return;
        }
        Alert.alert(t("privacy.alertPinSetTitle"), t("privacy.alertPinSetBody"));
        navigation.goBack();
        return;
      }
      if (mode === "change-old" || mode === "remove") {
        if (!(await verifyAppPin(pin))) {
          Alert.alert(t("privacy.alertWrongPinTitle"), t("privacy.alertWrongPinBody"));
          setDraft("");
          return;
        }
        if (mode === "remove") {
          const bio = await getOsBiometricsStatus();
          if (bio.available) {
            const auth = await requireUserPresence(t("privacy.confirmRemovePinPresence"), {
              allowPin: false,
            });
            if (!auth.ok) {
              Alert.alert(
                t("privacy.alertAuthRequiredTitle"),
                t("privacy.alertAuthRequiredBody"),
              );
              setDraft("");
              return;
            }
          }
          await clearAppPin();
          Alert.alert(t("privacy.alertPinRemoved"));
          navigation.goBack();
          return;
        }
        setDraft("");
        setMode("change-new");
        return;
      }
      if (mode === "change-new") {
        setFirst(pin);
        setDraft("");
        setMode("change-confirm");
        return;
      }
      if (mode === "change-confirm") {
        if (pin !== first) {
          Alert.alert(t("privacy.alertMismatchTitle"), t("privacy.alertMismatchBody"));
          setDraft("");
          setFirst("");
          setMode("change-new");
          return;
        }
        await setAppPin(pin);
        Alert.alert(t("privacy.alertPinUpdated"));
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert(
        t("privacy.alertErrorTitle"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  const keys = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["", "0", "⌫"],
  ];

  return (
    <ScreenChrome logoScale={0.77}>
      <AdaptiveText style={ui.title} baseFontSize={20}>
        {title}
      </AdaptiveText>
      <Text style={ui.caption}>{caption}</Text>

      <View style={styles.dots}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < draft.length ? styles.dotOn : styles.dotOff]}
          />
        ))}
      </View>

      <View style={styles.pad}>
        {keys.map((row, r) => (
          <View key={r} style={styles.padRow}>
            {row.map((lab, c) => {
              if (!lab) return <View key={c} style={styles.key} />;
              const isDel = lab === "⌫";
              return (
                <Pressable
                  key={c}
                  style={styles.key}
                  disabled={busy}
                  onPress={() => {
                    if (isDel) onDelete();
                    else void onDigit(lab);
                  }}
                >
                  <Text style={styles.keyLab}>{lab}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {draft.length >= 4 && draft.length < 6 ? (
        <Pressable
          style={[ui.primaryBtn, { marginTop: 16 }, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void submit(draft)}
        >
          <AdaptiveText style={ui.primaryBtnText} baseFontSize={16}>
            {t("common.continue")}
          </AdaptiveText>
        </Pressable>
      ) : null}
    </ScreenChrome>
  );
}

/** Used by AppLockGate — on-screen PIN pad only (no OS keyboard). */
export function UnlockPinPad({
  onSuccess,
  onCancel,
  cancelLabel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolvedCancel = cancelLabel ?? t("privacy.useBiometrics");

  async function tryPin(pin: string) {
    setBusy(true);
    setError(null);
    try {
      if (!(await hasAppPin())) {
        setError(t("privacy.noAppPinSet"));
        return;
      }
      if (!(await verifyAppPin(pin))) {
        setError(t("privacy.wrongPin"));
        setDraft("");
        return;
      }
      onSuccess();
    } finally {
      setBusy(false);
    }
  }

  function onDigit(d: string) {
    if (busy) return;
    const next = (draft + d).slice(0, 8);
    setDraft(next);
    if (next.length === 6) void tryPin(next);
  }

  const keys = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["", "0", "⌫"],
  ];

  return (
    <View style={styles.unlockWrap}>
      <AdaptiveText style={styles.unlockTitle} baseFontSize={20}>
        {t("privacy.enterPinTitle")}
      </AdaptiveText>

      <View style={styles.dotsHit}>
        <View style={styles.dots}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i < draft.length ? styles.dotOn : styles.dotOff]}
            />
          ))}
        </View>
      </View>

      {error ? <Text style={styles.unlockError}>{error}</Text> : null}

      <View style={styles.pad}>
        {keys.map((row, r) => (
          <View key={r} style={styles.padRow}>
            {row.map((lab, c) => {
              if (!lab) return <View key={c} style={styles.key} />;
              const isDel = lab === "⌫";
              return (
                <Pressable
                  key={c}
                  style={styles.key}
                  disabled={busy}
                  onPress={() => {
                    if (isDel) {
                      setDraft((p) => p.slice(0, -1));
                      return;
                    }
                    onDigit(lab);
                  }}
                >
                  <Text style={styles.keyLab}>{lab}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {draft.length >= 4 && draft.length !== 6 ? (
        <Pressable
          style={[ui.primaryBtn, { marginTop: 12, alignSelf: "stretch" }]}
          onPress={() => void tryPin(draft)}
        >
          <AdaptiveText style={ui.primaryBtnText} baseFontSize={16}>
            {t("privacy.unlock")}
          </AdaptiveText>
        </Pressable>
      ) : null}

      <Pressable onPress={onCancel} style={{ marginTop: 16 }}>
        <Text style={styles.cancel}>{resolvedCancel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  dotsHit: {
    paddingVertical: 16,
    alignSelf: "stretch",
    alignItems: "center",
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.fg,
  },
  dotOn: { backgroundColor: colors.fg },
  dotOff: { backgroundColor: colors.bg },
  pad: {
    marginTop: 16,
    width: "100%",
    alignSelf: "stretch",
    borderWidth: 1,
    borderColor: "#333333",
    borderRadius: 16,
    paddingVertical: 8,
    backgroundColor: colors.bg,
  },
  padRow: {
    flexDirection: "row",
    width: "100%",
  },
  key: {
    flex: 1,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  keyLab: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 22,
    color: colors.fg,
  },
  unlockWrap: {
    flex: 1,
    width: "100%",
    alignSelf: "stretch",
    alignItems: "stretch",
    paddingTop: 24,
  },
  unlockTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
  },
  unlockError: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: "#FF6B6B",
    marginBottom: 8,
    textAlign: "center",
  },
  cancel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
  },
});
