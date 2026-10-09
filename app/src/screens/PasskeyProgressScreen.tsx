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
import { useI18n } from "../i18n";
import {
  createNewPrfEntropy,
  createOrGetPrfEntropy,
  isNoCreateOptionError,
  mapPasskeyCreateError,
  PasskeyNoCreateOptionError,
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

export function PasskeyProgressScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "PasskeyProgress">>();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { provisionFromPasskeyEntropy } = useWallet();
  const mode = route.params.mode;
  const [phase, setPhase] = useState<Phase>(mode === "create" ? "creating" : "detecting");
  const started = useRef(false);
  const cancelled = useRef(false);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const phaseTitle = (p: Phase): string => {
    switch (p) {
      case "detecting":
        return t("onboarding.passkeyDetectingTitle");
      case "creating":
        return t("onboarding.passkeyCreatingTitle");
      case "deriving":
        return t("onboarding.passkeyDerivingTitle");
      case "discoveringIndexes":
        return t("onboarding.passkeyDiscoveringIndexesTitle");
      case "discoveringLabels":
        return t("onboarding.passkeyDiscoveringLabelsTitle");
      case "almostReady":
        return t("onboarding.passkeyAlmostReadyTitle");
    }
  };

  const phaseCaption = (p: Phase): string => {
    switch (p) {
      case "detecting":
        return t("onboarding.passkeyDetectingCaption");
      case "creating":
        return t("onboarding.passkeyCreatingCaption");
      case "deriving":
        return t("onboarding.passkeyDerivingCaption");
      case "discoveringIndexes":
        return t("onboarding.passkeyDiscoveringIndexesCaption");
      case "discoveringLabels":
        return t("onboarding.passkeyDiscoveringLabelsCaption");
      case "almostReady":
        return t("onboarding.passkeyAlmostReadyCaption");
    }
  };

  const clearPhaseTimers = useCallback(() => {
    for (const timer of phaseTimers.current) clearTimeout(timer);
    phaseTimers.current = [];
  }, []);

  const goBackTerms = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace("TermsOfUse", { mode: "passkey" });
  }, [navigation]);

  const fail = useCallback(
    (title: string, message: string, opts?: { offerSettings?: boolean }) => {
      const offerSettings =
        opts?.offerSettings ||
        /PRF|password manager|Google Password|passkey provider|No passkey provider/i.test(
          message,
        );
      Alert.alert(
        title,
        offerSettings ? `${message}\n\n${PRF_PROVIDER_HELP}` : message,
        offerSettings
          ? [
              {
                text: t("onboarding.passkeySettings"),
                onPress: () => {
                  void openPasskeyProviderSettings().finally(() => goBackTerms());
                },
              },
              {
                text: t("common.cancel"),
                style: "cancel",
                onPress: goBackTerms,
              },
            ]
          : [
              {
                text: "OK",
                onPress: goBackTerms,
              },
            ],
      );
    },
    [goBackTerms, t],
  );

  const failCreate = useCallback(
    (e: unknown) => {
      const mapped = mapPasskeyCreateError(e);
      fail(t("onboarding.passkeyCreateFailedTitle"), mapped.message, {
        offerSettings:
          mapped instanceof PasskeyNoCreateOptionError || isNoCreateOptionError(mapped),
      });
    },
    [fail, t],
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
    try {
      const entropy = await createNewPrfEntropy();
      if (cancelled.current) return;
      await runTimedProvisionPhases("create", entropy);
      if (cancelled.current) return;
      setPhase("almostReady");
      navigation.replace("Ready");
    } catch (e) {
      if (cancelled.current) return;
      if (/cancel|UserCancelled/i.test(e instanceof Error ? e.message : String(e))) {
        goBackTerms();
        return;
      }
      failCreate(e);
    }
  }, [failCreate, goBackTerms, navigation, runTimedProvisionPhases]);

  const offerRestoreAfterCancel = useCallback(() => {
    Alert.alert(
      t("onboarding.passkeyMissingTitle"),
      t("onboarding.passkeyMissingBody"),
      [
        {
          text: t("onboarding.passkeySettings"),
          onPress: () => void openPasskeyProviderSettings(),
        },
        {
          text: t("onboarding.passkeyRestore"),
          onPress: () => navigation.replace("RestoreWallet", { mode: "full" }),
        },
        {
          text: t("onboarding.passkeyCreateNew"),
          style: "destructive",
          onPress: () => {
            navigation.replace("PasskeyProgress", { mode: "create" });
          },
        },
        {
          text: t("common.cancel"),
          style: "cancel",
          onPress: () => navigation.replace("TermsOfUse", { mode: "passkey" }),
        },
      ],
    );
  }, [navigation, t]);

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
        // New install / no Basic passkey: skip the hang and create immediately.
        navigation.replace("PasskeyProgress", { mode: "create" });
        return;
      }
      throw e;
    }
  }, [navigation, runTimedProvisionPhases]);

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
            : t("common.unknownError");
        if (/cancel|UserCancelled/i.test(msg)) {
          offerRestoreAfterCancel();
          return;
        }
        if (mode === "create" || isNoCreateOptionError(e)) {
          failCreate(e);
          return;
        }
        fail(t("onboarding.passkeyOpenFailedTitle"), msg);
      }
    })();
    return () => {
      cancelled.current = true;
      clearPhaseTimers();
    };
  }, [
    clearPhaseTimers,
    fail,
    failCreate,
    mode,
    offerRestoreAfterCancel,
    runCreate,
    runDetect,
    t,
  ]);

  /** Settings escape hatch only while creating (not during detect). */
  const showPasskeySettings = phase === "creating";

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
      <View style={styles.logoRow}>
        <BasicLogo scale={1.2} />
      </View>

      <View style={styles.center}>
        <Text style={styles.title}>{phaseTitle(phase)}</Text>
        <Text style={styles.caption}>{phaseCaption(phase)}</Text>
        <ActivityIndicator color={colors.fg} style={styles.spin} />
        <Text style={styles.hint}>{t("onboarding.passkeyPleaseWait")}</Text>

        {showPasskeySettings ? (
          <View style={styles.links}>
            <Pressable
              style={styles.linkBtn}
              onPress={() => void openPasskeyProviderSettings()}
            >
              <Text style={styles.linkText}>{t("onboarding.passkeyOpenSettings")}</Text>
            </Pressable>
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
