import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { mnemonicFromEntropy, randomEntropy32 } from "../onboarding/mnemonicFromEntropy";
import {
  readBackupMeta,
  type BackupPackageMeta,
} from "../nostr/backupPackage";
import { setBackupReminderPending } from "../wallet/backupReminder";
import { getMnemonicSource } from "../wallet/mnemonicMeta";
import { AdaptiveText, useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

/**
 * Penpot 12 / 05e Backup hub.
 * Onboarding (no wallet yet): no passkey caption, no seed export, CTA to skip.
 * Active channel: thick white border + filled-dot “active” badge.
 */
export function AdvancedBackupScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const { hasWallet, provisionFromMnemonic } = useWallet();
  const [meta, setMeta] = useState<BackupPackageMeta | null>(null);
  const [passkeyOn, setPasskeyOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setMeta(await readBackupMeta());
        const source = await getMnemonicSource();
        setPasskeyOn(source === "passkey-prf");
      })();
    }, []),
  );

  const nostrOn = !!(meta?.enabled && meta.channel === "nostr");
  const homeOn = !!(meta?.enabled && meta.channel === "home");

  async function onContinueWithoutBackup() {
    setBusy(true);
    try {
      const mnemonic = mnemonicFromEntropy(await randomEntropy32());
      await provisionFromMnemonic(mnemonic, "device-only");
      await setBackupReminderPending();
      navigation.reset({ index: 0, routes: [{ name: "Ready" }] });
    } catch (e) {
      Alert.alert(t("backup.couldNotCreateWallet"), e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={ui.title}>{t("backup.title")}</Text>
        {passkeyOn ? (
          <Text style={ui.caption}>{t("backup.captionPasskey")}</Text>
        ) : !hasWallet ? (
          <Text style={ui.caption}>{t("backup.captionOnboarding")}</Text>
        ) : (
          <Text style={ui.caption}>{t("backup.captionDefault")}</Text>
        )}

        <BackupCard
          title={t("backup.passkeyTitle")}
          active={passkeyOn}
          body={passkeyOn ? t("backup.passkeyBodyOn") : t("backup.passkeyBodyOff")}
        />

        <BackupCard
          title={t("backup.nostrTitle")}
          active={nostrOn}
          body={t("backup.nostrBody")}
          onPress={() => navigation.navigate("NostrBackup")}
        />

        <BackupCard
          title={t("backup.homeTitle")}
          active={homeOn}
          body={t("backup.homeBody")}
          onPress={() => navigation.navigate("HomeServerBackup")}
        />

        {hasWallet ? (
          <Pressable
            style={ui.cardMuted}
            onPress={() => navigation.navigate("ExportRecoveryPhrase")}
          >
            <AdaptiveText style={ui.cardTitle} baseFontSize={14}>
              {t("backup.exportPhraseTitle")}
            </AdaptiveText>
            <Text style={[ui.caption, { textAlign: "left", marginBottom: 0 }]}>
              {t("backup.exportPhraseBody")}
            </Text>
          </Pressable>
        ) : null}

        <Text style={[ui.hint, { marginTop: 24 }]}>{t("backup.passphraseLossCaption")}</Text>

        {!hasWallet ? (
          <Pressable
            style={[ui.primaryBtn, { marginTop: 28 }, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => void onContinueWithoutBackup()}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>
                {t("backup.continueWithoutBackup")}
              </AdaptiveText>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenChrome>
  );
}

function BackupCard({
  title,
  body,
  active,
  onPress,
}: {
  title: string;
  body: ReactNode;
  active: boolean;
  onPress?: () => void;
}) {
  const { t } = useI18n();
  const content = (
    <>
      <View style={styles.cardHeader}>
        <AdaptiveText style={[ui.cardTitle, { marginBottom: 0, flex: 1 }]} baseFontSize={14}>
          {title}
        </AdaptiveText>
        {active ? (
          <View style={styles.activeRow}>
            <View style={styles.activeDot} />
            <Text style={styles.activeLabel}>{t("backup.active")}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[ui.caption, { textAlign: "left", marginBottom: 0, marginTop: 8 }]}>
        {body}
      </Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable style={active ? styles.cardActive : styles.cardIdle} onPress={onPress}>
        {content}
      </Pressable>
    );
  }

  return <View style={active ? styles.cardActive : styles.cardIdle}>{content}</View>;
}

const styles = StyleSheet.create({
  cardActive: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.fg,
    padding: 16,
    marginTop: 12,
  },
  cardIdle: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  activeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.fg,
  },
  activeLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.fg,
    lineHeight: 16,
  },
});
