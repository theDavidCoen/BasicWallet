/**
 * Step 1 — external recovery / sweep address (never Arkade boarding).
 * After save from exit wizard → step 2 prepare. From reminder → Home.
 */

import { useCallback, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { ExitStepHeader, EXIT_STEP } from "../components/ExitStepHeader";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, Hint, ScreenTitle, TextField } from "../components/ui";
import { getNetworkConfig } from "../config/network";
import { scheduleAutoPrepareSoon } from "../exit/autoPrepare";
import {
  readRecoveryAddress,
  writeRecoveryAddress,
} from "../exit/recoveryAddress";
import { dismissRecoveryReminder } from "../exit/recoveryReminder";
import { requireExitAuth } from "../exit/gates";
import { useWallet } from "../wallet/WalletProvider";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
export function ExitRecoveryAddressScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const route = useRoute<RouteProp<RootStackParamList, "ExitRecoveryAddress">>();
  const from = route.params?.from;
  const network = getNetworkConfig();
  const { selectedWallet } = useWallet();
  const walletId = selectedWallet?.kind === "arkade" ? selectedWallet.id : null;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inWizard = from === "exit";

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const cur = await readRecoveryAddress(network.id);
        setDraft(cur ?? "");
      })();
    }, [network.id]),
  );

  function routeAfterSave(savedNonEmpty: boolean) {
    if (from === "reminder") {
      navigation.navigate("Home");
      return;
    }
    if (from === "exit" && savedNonEmpty) {
      navigation.navigate("UnilateralExitPrepare");
      return;
    }
    if (from === "exit") {
      navigation.navigate("UnilateralExitHub");
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Settings");
  }

  async function onSave(nextDraft?: string) {
    const value = nextDraft !== undefined ? nextDraft : draft;
    const auth = await requireExitAuth(t("exit.confirmRecoveryAddress"));
    if (!auth.ok) {
      Alert.alert(t("exit.cancelled"), auth.reason);
      return;
    }
    setBusy(true);
    try {
      const res = await writeRecoveryAddress(network.id, value, { walletId });
      if (!res.ok) {
        Alert.alert(t("exit.addressTitle"), res.error);
        return;
      }
      setDraft(value.trim());
      if (value.trim()) {
        await dismissRecoveryReminder();
        scheduleAutoPrepareSoon("recovery-address-saved");
      }
      Alert.alert(
        t("exit.savedTitle"),
        value.trim()
          ? inWizard
            ? t("exit.savedWizardBody")
            : t("exit.savedBody")
          : t("exit.clearedBody"),
        [{ text: t("exit.ok"), onPress: () => routeAfterSave(!!value.trim()) }],
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {inWizard ? (
          <ExitStepHeader
            step={EXIT_STEP.recovery}
            title={t("exit.recoveryTitle")}
            caption={t("exit.recoveryWizardCaption")}
          />
        ) : (
          <>
            <ScreenTitle>{t("exit.recoveryTitle")}</ScreenTitle>
            <Caption>{t("exit.recoveryCaption")}</Caption>
          </>
        )}

        <Hint style={{ marginTop: inWizard ? 4 : 8 }}>
          {t("exit.networkLabel", { network: network.label })}
        </Hint>

        <Text style={styles.warn}>
          {t("exit.recoveryWarn")}
        </Text>

        <Text style={styles.label}>{t("exit.onchainAddressLabel")}</Text>
        <TextField
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={network.id === "mainnet" ? "bc1…" : "tb1…"}
          style={{ fontSize: 14, marginBottom: 0 }}
        />

        <Button busy={busy} onPress={() => void onSave()}>
          {inWizard ? t("exit.saveContinue") : t("exit.save")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onPress={() => void onSave("")}
        >
          {t("exit.clear")}
        </Button>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  warn: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    lineHeight: 18,
    marginTop: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 20,
    marginBottom: 6,
  },
});
