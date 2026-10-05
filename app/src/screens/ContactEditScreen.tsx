/**
 * Add / edit contact — name/username required; surname, custom fields, note, identifiers optional.
 * Type uses an inline scrollable dropdown (not a nested bottom sheet).
 */

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  createContactDraft,
  createEmptyField,
  createEmptyIdentifier,
  deleteContact,
  getContact,
  upsertContact,
} from "../contacts/contactStore";
import { ShareContactSheet } from "../components/contacts/ShareContactSheet";
import { resolveBip353ForContacts } from "../contacts/resolveBip353";
import { resolveNip05 } from "../contacts/resolveNip05";
import type { Contact, ContactField, ContactIdentifier, IdentifierKind } from "../contacts/types";
import {
  IDENTIFIER_KIND_LABELS,
  IDENTIFIER_KIND_ORDER,
  contactInitials,
  kindPillLabel,
} from "../contacts/types";
import { AdaptiveText, useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function ContactEditScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ContactEdit">>();
  const { t } = useI18n();
  const contactId = route.params?.contactId;
  const isNew = !contactId;

  const [draft, setDraft] = useState<Contact>(() => createContactDraft());
  const [kindPickerFor, setKindPickerFor] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<Record<string, string>>({});
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    const existing = getContact(contactId);
    if (existing) setDraft(existing);
  }, [contactId]);

  const title = isNew ? t("contacts.addTitle") : t("contacts.editTitle");
  const initials = useMemo(() => contactInitials(draft), [draft.name, draft.surname]);

  function placeholderForKind(kind: IdentifierKind): string {
    switch (kind) {
      case "ark":
        return t("contacts.phArk");
      case "onchain":
        return t("contacts.phOnchain");
      case "npub":
        return t("contacts.phNpub");
      case "nip05":
        return t("contacts.phNip05");
      case "lightning_address":
        return t("contacts.phLightning");
      case "bip353":
        return t("contacts.phBip353");
      case "lnurl":
        return t("contacts.phLnurl");
      default:
        return t("contacts.phValue");
    }
  }

  function patchIdent(id: string, patch: Partial<ContactIdentifier>) {
    setDraft((d) => ({
      ...d,
      identifiers: d.identifiers.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  }

  function patchField(id: string, patch: Partial<ContactField>) {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }

  function onSave() {
    try {
      upsertContact(draft);
      navigation.goBack();
    } catch (e) {
      Alert.alert(t("contacts.cannotSave"), e instanceof Error ? e.message : String(e));
    }
  }

  function onDelete() {
    if (isNew || !contactId) return;
    Alert.alert(t("contacts.deleteConfirmTitle"), draft.name || t("contacts.deleteConfirmFallback"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("contacts.deleteContact"),
        style: "destructive",
        onPress: () => {
          deleteContact(contactId);
          navigation.goBack();
        },
      },
    ]);
  }

  async function onVerify(ident: ContactIdentifier) {
    setVerifyBusy(ident.id);
    setVerifyMsg((m) => ({ ...m, [ident.id]: "" }));
    try {
      if (ident.kind === "nip05") {
        if (!ident.value.trim()) {
          setVerifyMsg((m) => ({ ...m, [ident.id]: t("contacts.verifyEnterNip05") }));
          return;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8_000);
        let r: Awaited<ReturnType<typeof resolveNip05>>;
        try {
          r = await resolveNip05(ident.value, ctrl.signal);
        } finally {
          clearTimeout(timer);
        }
        if (!r.ok) {
          setVerifyMsg((m) => ({ ...m, [ident.id]: r.message }));
          return;
        }
        patchIdent(ident.id, { lastResolved: r.hint });
        const extra = r.lud16 ? t("contacts.verifyOkLud16", { lud16: r.lud16 }) : "";
        setVerifyMsg((m) => ({
          ...m,
          [ident.id]: t("contacts.verifyOkNip05", {
            npub: r.npub.slice(0, 12),
            extra,
          }),
        }));
        return;
      }
      if (ident.kind === "bip353") {
        if (!ident.value.trim()) {
          setVerifyMsg((m) => ({ ...m, [ident.id]: t("contacts.verifyEnterBip353") }));
          return;
        }
        const r = await resolveBip353ForContacts(ident.value, "lightning");
        if (!r.ok) {
          setVerifyMsg((m) => ({ ...m, [ident.id]: r.message }));
          return;
        }
        patchIdent(ident.id, { lastResolved: r.hint });
        const desc = r.probe.description
          ? t("contacts.verifyOkBip353Desc", { description: r.probe.description })
          : "";
        setVerifyMsg((m) => ({
          ...m,
          [ident.id]: t("contacts.verifyOkBip353", { kind: r.probe.kind, desc }),
        }));
        return;
      }
      setVerifyMsg((m) => ({ ...m, [ident.id]: t("contacts.verifyOnlyNip05Bip353") }));
    } catch (e) {
      setVerifyMsg((m) => ({
        ...m,
        [ident.id]: e instanceof Error ? e.message : t("contacts.verifyFailed"),
      }));
    } finally {
      setVerifyBusy(null);
    }
  }

  const picking = draft.identifiers.find((i) => i.id === kindPickerFor) ?? null;

  return (
    <View style={styles.screenRoot}>
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>{title}</Text>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>{t("contacts.labelName")}</Text>
        <TextInput
          value={draft.name}
          onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          placeholder={t("contacts.placeholderName")}
          placeholderTextColor={colors.hint}
          style={styles.input}
        />

        <Text style={styles.label}>{t("contacts.labelSurname")}</Text>
        <TextInput
          value={draft.surname ?? ""}
          onChangeText={(surname) => setDraft((d) => ({ ...d, surname }))}
          placeholder={t("contacts.optional")}
          placeholderTextColor={colors.hint}
          style={styles.input}
        />

        <Text style={styles.section}>{t("contacts.sectionCustomFields")}</Text>
        {draft.fields.map((field) => (
          <View key={field.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t("contacts.fieldTitle")}</Text>
              <Pressable
                onPress={() =>
                  setDraft((d) => ({
                    ...d,
                    fields: d.fields.filter((f) => f.id !== field.id),
                  }))
                }
              >
                <Text style={styles.linkDanger}>{t("contacts.remove")}</Text>
              </Pressable>
            </View>
            <TextInput
              value={field.key}
              onChangeText={(key) => patchField(field.id, { key })}
              placeholder={t("contacts.placeholderKey")}
              placeholderTextColor={colors.hint}
              style={styles.input}
            />
            <TextInput
              value={field.value}
              onChangeText={(value) => patchField(field.id, { value })}
              placeholder={t("contacts.placeholderValue")}
              placeholderTextColor={colors.hint}
              style={styles.input}
            />
          </View>
        ))}
        <Pressable
          style={styles.secondary}
          onPress={() =>
            setDraft((d) => ({
              ...d,
              fields: [...d.fields, createEmptyField()],
            }))
          }
        >
          <AdaptiveText style={styles.secondaryText} baseFontSize={14}>
            {t("contacts.addField")}
          </AdaptiveText>
        </Pressable>

        <Text style={styles.label}>{t("contacts.labelNote")}</Text>
        <TextInput
          value={draft.note ?? ""}
          onChangeText={(note) => setDraft((d) => ({ ...d, note }))}
          placeholder={t("contacts.optional")}
          placeholderTextColor={colors.hint}
          style={[styles.input, styles.inputMulti]}
          multiline
        />

        <Text style={styles.section}>{t("contacts.sectionIdentifiers")}</Text>
        {draft.identifiers.map((ident, idx) => (
          <View key={ident.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>#{idx + 1}</Text>
              <Pressable
                onPress={() =>
                  setDraft((d) => ({
                    ...d,
                    identifiers: d.identifiers.filter((i) => i.id !== ident.id),
                  }))
                }
              >
                <Text style={styles.linkDanger}>{t("contacts.remove")}</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>{t("contacts.labelType")}</Text>
            <Pressable
              style={styles.dropdown}
              onPress={() => setKindPickerFor(ident.id)}
              accessibilityRole="button"
              accessibilityLabel={t("contacts.chooseTypeA11y")}
            >
              <Text style={styles.dropdownText}>{kindPillLabel(ident)}</Text>
              <Text style={styles.dropdownChevron}>▾</Text>
            </Pressable>

            {ident.kind === "custom" ? (
              <>
                <Text style={styles.label}>{t("contacts.labelCustomType")}</Text>
                <TextInput
                  value={ident.customKindLabel ?? ""}
                  onChangeText={(customKindLabel) => patchIdent(ident.id, { customKindLabel })}
                  placeholder={t("contacts.placeholderCustomType")}
                  placeholderTextColor={colors.hint}
                  style={styles.input}
                />
              </>
            ) : null}

            <Text style={styles.label}>{t("contacts.labelIdentifier")}</Text>
            <TextInput
              value={ident.value}
              onChangeText={(value) => patchIdent(ident.id, { value })}
              placeholder={placeholderForKind(ident.kind)}
              placeholderTextColor={colors.hint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />

            <Text style={styles.label}>{t("contacts.labelOptionalLabel")}</Text>
            <TextInput
              value={ident.label ?? ""}
              onChangeText={(label) => patchIdent(ident.id, { label })}
              placeholder={t("contacts.placeholderLabel")}
              placeholderTextColor={colors.hint}
              style={styles.input}
            />

            {ident.kind === "nip05" || ident.kind === "bip353" ? (
              <Pressable
                style={styles.verifyBtn}
                onPress={() => void onVerify(ident)}
                disabled={verifyBusy === ident.id}
              >
                {verifyBusy === ident.id ? (
                  <ActivityIndicator color={colors.fg} size="small" />
                ) : (
                  <Text style={styles.verifyText}>{t("contacts.verify")}</Text>
                )}
              </Pressable>
            ) : null}
            {verifyMsg[ident.id] ? (
              <Text
                style={[
                  styles.verifyMsg,
                  verifyMsg[ident.id]!.startsWith("OK") ? styles.verifyOk : styles.verifyErr,
                ]}
              >
                {verifyMsg[ident.id]}
              </Text>
            ) : null}
          </View>
        ))}

        <Pressable
          style={styles.secondary}
          onPress={() =>
            setDraft((d) => ({
              ...d,
              identifiers: [...d.identifiers, createEmptyIdentifier("ark")],
            }))
          }
        >
          <AdaptiveText style={styles.secondaryText} baseFontSize={14}>
            {t("contacts.addIdentifier")}
          </AdaptiveText>
        </Pressable>

        <Pressable
          style={[styles.primary, !draft.name.trim() && { opacity: 0.5 }]}
          disabled={!draft.name.trim()}
          onPress={onSave}
        >
          <AdaptiveText style={styles.primaryText} baseFontSize={15}>
            {t("contacts.save")}
          </AdaptiveText>
        </Pressable>

        {!isNew ? (
          <>
            <Pressable
              style={styles.shareBtn}
              onPress={() => setShareOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("contacts.shareContactA11y")}
            >
              <AdaptiveText style={styles.shareText} baseFontSize={14}>
                {t("contacts.shareContact")}
              </AdaptiveText>
            </Pressable>
            <Pressable
              style={styles.deleteHit}
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={t("contacts.deleteContactA11y")}
            >
              <Text style={styles.deleteText}>{t("contacts.deleteContact")}</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      {/* Root-level modal dropdown — scrollable, not nested in the card sheet */}
      <Modal
        visible={!!picking}
        transparent
        animationType="fade"
        onRequestClose={() => setKindPickerFor(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setKindPickerFor(null)}>
          <Pressable style={styles.dropdownPanel} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{t("contacts.typeSheetTitle")}</Text>
            <ScrollView
              style={styles.dropdownScroll}
              contentContainerStyle={{ paddingBottom: 8 }}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {IDENTIFIER_KIND_ORDER.map((k) => (
                <Pressable
                  key={k}
                  style={[styles.kindRow, picking?.kind === k && styles.kindRowOn]}
                  onPress={() => {
                    if (picking) patchIdent(picking.id, { kind: k });
                    setKindPickerFor(null);
                  }}
                >
                  <Text style={styles.kindRowText}>{IDENTIFIER_KIND_LABELS[k]}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenChrome>

    {/* Outside ScreenChrome so the sheet is full-bleed (chrome has paddingHorizontal 28). */}
    {!isNew ? (
      <ShareContactSheet
        open={shareOpen}
        onDismiss={() => setShareOpen(false)}
        contact={draft}
      />
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: colors.bg },
  avatar: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  avatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
  },
  scroll: { flex: 1 },
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 6,
  },
  section: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
    marginTop: 8,
    marginBottom: 10,
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
    marginBottom: 12,
  },
  inputMulti: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: colors.card,
  },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.caption,
  },
  linkDanger: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: "#E07070",
  },
  dropdown: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#111",
  },
  dropdownText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
  dropdownChevron: {
    color: colors.hint,
    fontSize: 14,
  },
  verifyBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 6,
  },
  verifyText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
  verifyMsg: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    marginBottom: 4,
  },
  verifyOk: { color: "#8CFF9A" },
  verifyErr: { color: "#E07070" },
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
  shareBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  shareText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
  deleteHit: {
    alignItems: "center",
    paddingVertical: 16,
    marginTop: 4,
  },
  deleteText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: "#E07070",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  dropdownPanel: {
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 16,
    paddingHorizontal: 14,
    maxHeight: "70%",
  },
  dropdownScroll: {
    maxHeight: 360,
  },
  sheetTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 12,
  },
  kindRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  kindRowOn: {
    borderColor: colors.fg,
    backgroundColor: "#1A1A1A",
  },
  kindRowText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
});
