/**
 * Intermediate onboarding screen while passkey / PRF / labels run.
 * Logo chrome (no back / Get Started). Timed mid-phases so long provision
 * does not look frozen. Style aligned with WalletWarmup WELCOME BACK.
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { BasicLogo } from "../components/BasicLogo";
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
import { useWallet } from "../wallet/WalletProvider";

type CreatePhase = "creating" | "deriving" | "almostReady";
type DetectPhase =
  | "detecting"
  | "discoveringIndexes"
  | "discoveringLabels"
  | "almostReady";
type Phase = CreatePhase | DetectPhase;

const PHASE_TITLE: Record<Phase, string> = {
  detecting: "DETECTING PASSKEY",
  creating: "CREATING PASSKEY",
  deriving: "DERIVING SECRETS",
  discoveringIndexes: "DISCOVERING INDEXES",
  discoveringLabels: "DISCOVERING LABELS",
  almostReady: "ALMOST READY",
};

const PHASE_CAPTION: Partial<Record<Phase, string>> = {
  detecting:
    "Looking for an existing passkey.\nIf the wrong manager opens, tap Sign-in options or use the links below.",
  creating:
    "Save the passkey in Google Password Manager\n(or another provider that supports PRF).",
  deriving: "Building your wallet keys from the passkey proof.",
  discoveringIndexes: "Scanning for passkey wallets…",
  discoveringLabels: "Fetching names from Nostr…",
  almostReady: "Opening your wallet…",
};

export function PasskeyProgressScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "PasskeyProgress">>();
  const insets = useSafeAreaInsets();
  const { provisionFromPasskeyEntropy } = useWallet();
  const mode = route.params.mode;
  const [phase, setPhase] = useState<Phase>(mode === "create" ? "creating" : "detecting");
  const started = useRef(false);
  const cancelled = useRef(false);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearPhaseTimers = useCallback(() => {
    for (const t of phaseTimers.current) clearTimeout(t);
    phaseTimers.current = [];
  }, []);

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

  const runTimedProvisionPhases = useCallback(
    async (kind: "create" | "detect", entropy: Uint8Array) => {
      clearPhaseTimers();
      if (kind === "create") {
        setPhase("deriving");
        phaseTimers.current.push(
          setTimeout(() => {
            if (!cancelled.current) setPhase("almostReady");
          }, 1600),
        );
      } else {
        setPhase("discoveringIndexes");
        phaseTimers.current.push(
          setTimeout(() => {
            if (!cancelled.current) setPhase("discoveringLabels");
          }, 900),
        );
        phaseTimers.current.push(
          setTimeout(() => {
            if (!cancelled.current) setPhase("almostReady");
          }, 2200),
        );
      }
      try {
        await provisionFromPasskeyEntropy(entropy);
      } finally {
        clearPhaseTimers();
      }
    },
    [clearPhaseTimers, provisionFromPasskeyEntropy],
  );

  const runCreate = useCallback(async () => {
    setPhase("creating");
    const entropy = await createNewPrfEntropy();
    if (cancelled.current) return;
    await runTimedProvisionPhases("create", entropy);
    if (cancelled.current) return;
    setPhase("almostReady");
    navigation.replace("Ready");
  }, [navigation, runTimedProvisionPhases]);

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
      await runTimedProvisionPhases("detect", entropy);
      if (cancelled.current) return;
      setPhase("almostReady");
      navigation.replace("Ready");
    } catch (e) {
      if (cancelled.current) return;
      if (e instanceof PasskeyNotFoundError) {
        offerCreateOrRestore();
        return;
      }
      throw e;
    }
  }, [navigation, offerCreateOrRestore, runTimedProvisionPhases]);

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
    return () => {
      cancelled.current = true;
      clearPhaseTimers();
    };
  }, [clearPhaseTimers, fail, mode, offerCreateOrRestore, runCreate, runDetect]);

  const showPasskeySettings =
    phase === "detecting" || phase === "creating";
  /** Always available on detect path (fresh install or after reset). */
  const showCreateInstead = mode === "detect";

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
      <View style={styles.logoRow}>
        <BasicLogo scale={1.2} />
      </View>

      <View style={styles.center}>
        <Text style={styles.title}>{PHASE_TITLE[phase]}</Text>
        <Text style={styles.caption}>{PHASE_CAPTION[phase] ?? "Please wait…"}</Text>
        <ActivityIndicator color={colors.fg} style={styles.spin} />
        <Text style={styles.hint}>Please wait</Text>

        {showPasskeySettings || showCreateInstead ? (
          <View style={styles.links}>
            {showPasskeySettings ? (
              <Pressable
                style={styles.linkBtn}
                onPress={() => void openPasskeyProviderSettings()}
              >
                <Text style={styles.linkText}>Open passkey settings</Text>
              </Pressable>
            ) : null}
            {showCreateInstead ? (
              <Pressable
                style={styles.linkBtn}
                onPress={() => {
                  cancelled.current = true;
                  clearPhaseTimers();
                  navigation.replace("PasskeyProgress", { mode: "create" });
                }}
              >
                <Text style={styles.linkText}>Create new passkey instead</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  logoRow: {
    alignItems: "center",
    paddingTop: 8,
    minHeight: 48,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 48,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 16,
  },
  spin: {
    marginTop: 32,
  },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginTop: 16,
  },
  links: {
    alignItems: "center",
    marginTop: 28,
    gap: 4,
  },
  linkBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  linkText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
    textDecorationLine: "underline",
  },
});
