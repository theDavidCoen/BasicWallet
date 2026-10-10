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
          <Text style={ui.title}>{t("nostr.title")}</Text>
          <Text style={ui.caption}>{t("nostr.caption")}</Text>
          <Text style={[ui.hint, { marginTop: 24 }]}>{t("nostr.noIdentity")}</Text>
          <Pressable
            style={ui.primaryBtn}
            onPress={() => navigation.navigate("GenerateIdentityWarning")}
          >
            <Text style={ui.primaryBtnText}>{t("nostr.generate")}</Text>
          </Pressable>
          <Pressable
            style={ui.secondaryBtn}
            onPress={() => navigation.navigate("ImportNsecWarning")}
          >
            <Text style={ui.secondaryBtnText}>{t("nostr.importNsec")}</Text>
          </Pressable>
        </ScrollView>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={ui.title}>{t("nostr.title")}</Text>
        <Text style={ui.caption}>{t("nostr.caption")}</Text>

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

        <Pressable
          style={[ui.secondaryBtn, saving && { opacity: 0.6 }]}
          disabled={saving}
          onPress={() => void onSaveProfile()}
        >
          <Text style={ui.secondaryBtnText}>
            {saving ? t("nostr.saving") : t("nostr.saveProfile")}
          </Text>
        </Pressable>
        <Text style={[ui.hint, { marginTop: 8 }]}>{t("nostr.saveHint")}</Text>

        <NavRow
          label={t("nostr.exportNsec")}
          onPress={() => navigation.navigate("ExportNsecWarning")}
        />
        <NavRow
          label={t("nostr.importNsec")}
          onPress={() => navigation.navigate("ImportNsecWarning")}
        />
        <NavRow
          label={t("nostr.encryptedBackup")}
          value={backup?.enabled ? t("nostr.backupOn") : t("nostr.backupOff")}
          onPress={() => navigation.navigate("AdvancedBackup")}
        />

        <Pressable style={[ui.primaryBtn, { marginTop: 16 }]} onPress={() => void onShareNpub()}>
          <Text style={ui.primaryBtnText}>{t("nostr.shareNpub")}</Text>
        </Pressable>

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

function NavRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.navRow} onPress={onPress}>
      <Text style={styles.navLabel}>{label}</Text>
      <Text style={styles.navValue}>{value ?? "›"}</Text>
    </Pressable>
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
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginBottom: 6,
  },
  value: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
  copyHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 8,
  },
  input: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
    padding: 0,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginTop: 4,
  },
  navLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    color: colors.fg,
  },
  navValue: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.hint,
  },
});
