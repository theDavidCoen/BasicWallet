/**
 * Intermediate onboarding screen while passkey / PRF / labels run.
 * Mirrors Glow “Detecting passkey…” / “Discovering labels…” so the UI
 * never looks frozen behind the system Credential Manager sheet.
 */

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import {
  createNewPrfEntropy,
  createOrGetPrfEntropy,
  PasskeyNotFoundError,
  PasskeyPrfUnavailableError,
} from "../onboarding/passkeyPrf";
import {
  openPasskeyProviderSettings,
  PRF_PROVIDER_HELP,
} from "../onboarding/passkeyProviderSettings";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

type Phase = "detecting" | "creating" | "discovering" | "opening";

const PHASE_LABEL: Record<Phase, string> = {
  detecting: "Detecting passkey…",
  creating: "Creating passkey…",
  discovering: "Discovering labels…",
  opening: "Opening wallet…",
};

export function PasskeyProgressScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "PasskeyProgress">>();
  const { provisionFromPasskeyEntropy } = useWallet();
  const mode = route.params.mode;
  const [phase, setPhase] = useState<Phase>(mode === "create" ? "creating" : "detecting");
  const started = useRef(false);
  const cancelled = useRef(false);

  const fail = useCallback(
    (title: string, message: string) => {
      const prfHint = /PRF|password manager|Google Password/i.test(message);
      Alert.alert(
        title,
        prfHint ? `${message}\n\n${PRF_PROVIDER_HELP}` : message,
        prfHint
          ? [
              {
                text: "Passkey settings",
                onPress: () => {
                  void openPasskeyProviderSettings().finally(() => {
                    if (navigation.canGoBack()) navigation.goBack();
                    else navigation.replace("TermsOfUse", { mode: "passkey" });
                  });
                },
              },
              {
                text: "OK",
                style: "cancel",
                onPress: () => {
                  if (navigation.canGoBack()) navigation.goBack();
                  else navigation.replace("TermsOfUse", { mode: "passkey" });
                },
              },
            ]
          : [
              {
                text: "OK",
                onPress: () => {
                  if (navigation.canGoBack()) navigation.goBack();
                  else navigation.replace("TermsOfUse", { mode: "passkey" });
                },
              },
            ],
      );
    },
    [navigation],
  );

  const runCreate = useCallback(async () => {
    setPhase("creating");
    const entropy = await createNewPrfEntropy();
    if (cancelled.current) return;
    setPhase("discovering");
    await provisionFromPasskeyEntropy(entropy);
    if (cancelled.current) return;
    setPhase("opening");
    navigation.replace("Ready");
  }, [navigation, provisionFromPasskeyEntropy]);

  const offerCreateOrRestore = useCallback(() => {
    Alert.alert(
      "Passkey missing",
      "No matching Basic Wallet passkey was found.\n\n" +
        "Create needs a PRF-capable provider such as Google Password Manager.",
      [
        {
          text: "Passkey settings",
          onPress: () => void openPasskeyProviderSettings(),
        },
        {
          text: "Restore",
          onPress: () => navigation.replace("RestoreWallet", { mode: "full" }),
        },
        {
          text: "Create new passkey",
          style: "destructive",
          onPress: () => {
            navigation.replace("PasskeyProgress", { mode: "create" });
          },
        },
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => navigation.replace("TermsOfUse", { mode: "passkey" }),
        },
      ],
    );
  }, [navigation]);

  const runDetect = useCallback(async () => {
    setPhase("detecting");
    try {
      const entropy = await createOrGetPrfEntropy();
      if (cancelled.current) return;
      setPhase("discovering");
      await provisionFromPasskeyEntropy(entropy);
      if (cancelled.current) return;
      setPhase("opening");
      navigation.replace("Ready");
    } catch (e) {
      if (cancelled.current) return;
      if (e instanceof PasskeyNotFoundError) {
        offerCreateOrRestore();
        return;
      }
      throw e;
    }
  }, [navigation, offerCreateOrRestore, provisionFromPasskeyEntropy]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (mode === "create") await runCreate();
        else await runDetect();
      } catch (e) {
        if (cancelled.current) return;
        const msg =
          e instanceof PasskeyPrfUnavailableError || e instanceof Error
            ? e.message
            : "Unknown error";
        if (/cancel|UserCancelled/i.test(msg)) {
          offerCreateOrRestore();
          return;
        }
        fail(mode === "create" ? "Could not create wallet" : "Could not open wallet", msg);
      }
    })();
  }, [fail, mode, offerCreateOrRestore, runCreate, runDetect]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            cancelled.current = true;
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.replace("OnboardingCreate");
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Get Started</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.fg} />
        <Text style={styles.status}>{PHASE_LABEL[phase]}</Text>
        {phase === "detecting" ? (
          <Text style={styles.hint}>
            Looking for an existing passkey.{"\n"}
            If the wrong manager opens, tap{" "}
            <Text style={styles.hintEm}>Sign-in options</Text> or use the links below.
          </Text>
        ) : null}
        {phase === "creating" ? (
          <Text style={styles.hint}>
            Save the passkey in <Text style={styles.hintEm}>Google Password Manager</Text>
            {"\n"}
            (or another provider that supports PRF).
          </Text>
        ) : null}
      </View>

      {phase === "detecting" || phase === "creating" ? (
        <View style={styles.footer}>
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => void openPasskeyProviderSettings()}
          >
            <Text style={styles.secondaryBtnText}>Open passkey settings</Text>
          </Pressable>
          {phase === "detecting" ? (
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                cancelled.current = true;
                navigation.replace("PasskeyProgress", { mode: "create" });
              }}
            >
              <Text style={styles.secondaryBtnText}>Create new passkey instead</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    minHeight: 48,
  },
  back: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 32,
    color: colors.fg,
    lineHeight: 36,
    width: 40,
  },
  headerTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
  },
  headerSpacer: { width: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 28,
    paddingBottom: 64,
  },
  status: {
    ...ui.caption,
    fontSize: 15,
    color: colors.fg,
  },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 4,
  },
  hintEm: {
    color: colors.fg,
    fontFamily: "JetBrainsMono_700Bold",
  },
  secondaryBtn: {
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  secondaryBtnText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
    textDecorationLine: "underline",
  },
  footer: {
    alignItems: "center",
    marginBottom: 36,
    gap: 4,
  },
});
