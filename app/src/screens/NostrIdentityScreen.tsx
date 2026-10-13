import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  Button,
  Caption,
  Hint,
  ScreenTitle,
  SettingsRow,
} from "../components/ui";
import {
  readBackupMeta,
  type BackupPackageMeta,
} from "../nostr/backupPackage";
import {
  EMPTY_PROFILE,
  readPublicIdentity,
  type NostrProfile,
  type NostrPublicIdentity,
} from "../nostr/identityStore";
import { saveAndPublishNostrProfile } from "../nostr/profileMetadata";
import { midEllipsis } from "../nostr/keys";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { ui } from "../theme/ui";

/** Penpot 05d — Nostr identity hub. */
export function NostrIdentityScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<NostrPublicIdentity | null>(null);
  const [backup, setBackup] = useState<BackupPackageMeta | null>(null);
  const [profile, setProfile] = useState<NostrProfile>({ ...EMPTY_PROFILE });
  const [saving, setSaving] = useState(false);
  const [npubCopied, setNpubCopied] = useState(false);
  const npubCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const id = await readPublicIdentity();
      setIdentity(id);
      if (id) setProfile({ ...EMPTY_PROFILE, ...id.profile });
      setBackup(await readBackupMeta());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        if (npubCopiedTimer.current) clearTimeout(npubCopiedTimer.current);
      };
    }, [reload]),
  );

  async function onSaveProfile() {
    setSaving(true);
    try {
      const result = await saveAndPublishNostrProfile(profile);
      const failN = result.failedRelays.length;
      Alert.alert(
        t("nostr.savedTitle"),
        failN > 0
          ? t("nostr.savedPartial", { ok: result.okRelays.length, fail: failN })
          : t("nostr.savedOk", { ok: result.okRelays.length }),
      );
      await reload();
    } catch (e) {
      Alert.alert(t("nostr.saveFailed"), e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setSaving(false);
    }
  }

  async function onCopyNpub() {
    if (!identity?.npub) return;
    await Clipboard.setStringAsync(identity.npub);
    setNpubCopied(true);
    if (npubCopiedTimer.current) clearTimeout(npubCopiedTimer.current);
    npubCopiedTimer.current = setTimeout(() => setNpubCopied(false), 1500);
  }

  async function onShareNpub() {
    if (!identity?.npub) return;
    try {
      await Share.share({ message: identity.npub });
    } catch (e) {
      Alert.alert(
        t("nostr.shareFailed"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
    }
  }

  if (loading) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ActivityIndicator color={colors.fg} style={{ marginTop: 40 }} />
      </ScreenChrome>
    );
  }

  if (!identity) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ScreenTitle>{t("nostr.title")}</ScreenTitle>
          <Caption>{t("nostr.caption")}</Caption>
          <Hint style={{ marginTop: 24 }}>{t("nostr.noIdentity")}</Hint>
          <Button onPress={() => navigation.navigate("GenerateIdentityWarning")}>
            {t("nostr.generate")}
          </Button>
          <Button
            variant="secondary"
            onPress={() => navigation.navigate("ImportNsecWarning")}
          >
            {t("nostr.importNsec")}
          </Button>
        </ScrollView>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ScreenTitle>{t("nostr.title")}</ScreenTitle>
        <Caption>{t("nostr.caption")}</Caption>

        <Pressable
          style={styles.field}
          onPress={() => void onCopyNpub()}
          accessibilityRole="button"
          accessibilityHint={t("nostr.copyNpubA11y")}
        >
          <Text style={styles.label}>{t("nostr.npub")}</Text>
          <Text style={styles.value}>{midEllipsis(identity.npub, 12, 8)}</Text>
          <Text style={styles.copyHint}>
            {npubCopied ? t("common.copied") : t("common.tapToCopy")}
          </Text>
        </Pressable>
        <Editable
          label={t("nostr.nip05")}
          value={profile.nip05}
          onChange={(nip05) => setProfile((p) => ({ ...p, nip05 }))}
          placeholder={t("nostr.phNip05")}
        />
        <Editable
          label={t("nostr.displayName")}
          value={profile.displayName}
          onChange={(displayName) => setProfile((p) => ({ ...p, displayName }))}
          placeholder={t("nostr.phDisplayName")}
        />
        <Editable
          label={t("nostr.lightningAddress")}
          value={profile.lightningAddress}
          onChange={(lightningAddress) => setProfile((p) => ({ ...p, lightningAddress }))}
          placeholder={t("nostr.phLightning")}
        />
        <Editable
          label={t("nostr.about")}
          value={profile.about}
          onChange={(about) => setProfile((p) => ({ ...p, about }))}
          placeholder={t("nostr.phAbout")}
        />
        <Editable
          label={t("nostr.pictureUrl")}
          value={profile.picture}
          onChange={(picture) => setProfile((p) => ({ ...p, picture }))}
          placeholder={t("nostr.phPicture")}
        />
        <Editable
          label={t("nostr.website")}
          value={profile.website}
          onChange={(website) => setProfile((p) => ({ ...p, website }))}
          placeholder={t("nostr.phWebsite")}
        />

        <Button
          variant="secondary"
          disabled={saving}
          style={saving ? { opacity: 0.6 } : undefined}
          onPress={() => void onSaveProfile()}
        >
          {saving ? t("nostr.saving") : t("nostr.saveProfile")}
        </Button>
        <Hint style={{ marginTop: 8 }}>{t("nostr.saveHint")}</Hint>

        <SettingsRow
          label={t("nostr.exportNsec")}
          onPress={() => navigation.navigate("ExportNsecWarning")}
          style={styles.navRow}
        />
        <SettingsRow
          label={t("nostr.importNsec")}
          onPress={() => navigation.navigate("ImportNsecWarning")}
          style={styles.navRow}
        />
        <SettingsRow
          label={t("nostr.encryptedBackup")}
          onPress={() => navigation.navigate("AdvancedBackup")}
          style={styles.navRow}
          right={
            <Text style={styles.navValue}>
              {backup?.enabled ? t("nostr.backupOn") : t("nostr.backupOff")}
            </Text>
          }
        />

        <Button style={{ marginTop: 16 }} onPress={() => void onShareNpub()}>
          {t("nostr.shareNpub")}
        </Button>

        <Text
          style={[ui.footerLink, { marginTop: 8 }]}
          onPress={() => navigation.navigate("GenerateIdentityWarning")}
        >
          {t("nostr.generate")}
        </Text>
      </ScrollView>
    </ScreenChrome>
  );
}

function Editable({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.hint}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  field: {
    marginTop: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.hint,
    marginBottom: 6,
  },
  value: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.fg,
  },
  copyHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.hint,
    marginTop: 8,
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.fg,
    padding: 0,
  },
  navRow: {
    marginTop: 4,
  },
  navValue: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.hint,
  },
});
