/**
 * Add / edit contact (Penpot 08c / 08e) — multi identifiers, custom fields, type dropdown.
 */

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { InteractiveBottomSheet } from "../components/sheet/InteractiveBottomSheet";
import {
  createContactDraft,
  createEmptyField,
  createEmptyIdentifier,
  deleteContact,
  getContact,
  upsertContact,
} from "../contacts/contactStore";
import { resolveBip353ForContacts } from "../contacts/resolveBip353";
import { resolveNip05 } from "../contacts/resolveNip05";
import type { Contact, ContactField, ContactIdentifier, IdentifierKind } from "../contacts/types";
import {
  IDENTIFIER_KIND_LABELS,
  IDENTIFIER_KIND_ORDER,
  kindPillLabel,
} from "../contacts/types";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function ContactEditScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ContactEdit">>();
  const contactId = route.params?.contactId;
  const isNew = !contactId;

  const [draft, setDraft] = useState<Contact>(() => createContactDraft());
  const [kindPickerFor, setKindPickerFor] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!contactId) return;
    const existing = getContact(contactId);
    if (existing) setDraft(existing);
  }, [contactId]);

  const title = isNew ? "ADD CONTACT" : "EDIT CONTACT";
  const initial = useMemo(() => {
    const t = draft.name.trim();
    return t ? t[0]!.toUpperCase() : "?";
  }, [draft.name]);

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
      Alert.alert("Cannot save", e instanceof Error ? e.message : String(e));
    }
  }

  function onDelete() {
    if (isNew || !contactId) return;
    Alert.alert("Delete contact?", draft.name || "This contact", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
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
        const r = await resolveNip05(ident.value);
        if (!r.ok) {
          setVerifyMsg((m) => ({ ...m, [ident.id]: r.message }));
          return;
        }
        patchIdent(ident.id, { lastResolved: r.hint });
        const extra = r.lud16 ? ` · lud16 ${r.lud16}` : "";
        setVerifyMsg((m) => ({
          ...m,
          [ident.id]: `OK → ${r.npub.slice(0, 12)}…${extra}`,
        }));
        return;
      }
      if (ident.kind === "bip353") {
        const r = await resolveBip353ForContacts(ident.value, "lightning");
        if (!r.ok) {
          setVerifyMsg((m) => ({ ...m, [ident.id]: r.message }));
          return;
        }
        patchIdent(ident.id, { lastResolved: r.hint });
        setVerifyMsg((m) => ({
          ...m,
          [ident.id]: `OK · ${r.probe.kind}${r.probe.description ? ` · ${r.probe.description}` : ""}`,
        }));
        return;
      }
      setVerifyMsg((m) => ({ ...m, [ident.id]: "Verify is for NIP-05 and BIP 353." }));
    } finally {
      setVerifyBusy(null);
    }
  }

  const picking = draft.identifiers.find((i) => i.id === kindPickerFor) ?? null;

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>{title}</Text>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>name</Text>
        <TextInput
          value={draft.name}
          onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          placeholder="Bob"
          placeholderTextColor={colors.hint}
          style={styles.input}
        />

        <Text style={styles.label}>note</Text>
        <TextInput
          value={draft.note ?? ""}
          onChangeText={(note) => setDraft((d) => ({ ...d, note }))}
          placeholder="Optional"
          placeholderTextColor={colors.hint}
          style={[styles.input, styles.inputMulti]}
          multiline
        />

        <Text style={styles.section}>Identifiers</Text>
        {draft.identifiers.map((ident, idx) => (
          <View key={ident.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>#{idx + 1}</Text>
              {draft.identifiers.length > 1 ? (
                <Pressable
                  onPress={() =>
                    setDraft((d) => ({
                      ...d,
                      identifiers: d.identifiers.filter((i) => i.id !== ident.id),
                    }))
                  }
                >
                  <Text style={styles.linkDanger}>Remove</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.label}>type</Text>
            <Pressable style={styles.dropdown} onPress={() => setKindPickerFor(ident.id)}>
              <Text style={styles.dropdownText}>{kindPillLabel(ident)}</Text>
              <Text style={styles.dropdownChevron}>▾</Text>
            </Pressable>

            {ident.kind === "custom" ? (
              <>
                <Text style={styles.label}>custom type label</Text>
                <TextInput
                  value={ident.customKindLabel ?? ""}
                  onChangeText={(customKindLabel) => patchIdent(ident.id, { customKindLabel })}
                  placeholder="e.g. Telegram"
                  placeholderTextColor={colors.hint}
                  style={styles.input}
                />
              </>
            ) : null}

            <Text style={styles.label}>identifier</Text>
            <TextInput
              value={ident.value}
              onChangeText={(value) => patchIdent(ident.id, { value })}
              placeholder={placeholderForKind(ident.kind)}
              placeholderTextColor={colors.hint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />

            <Text style={styles.label}>label (optional)</Text>
            <TextInput
              value={ident.label ?? ""}
              onChangeText={(label) => patchIdent(ident.id, { label })}
              placeholder="e.g. work"
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
                  <Text style={styles.verifyText}>Verify</Text>
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
          <Text style={styles.secondaryText}>+ Add identifier</Text>
        </Pressable>

        <Text style={styles.section}>Custom fields</Text>
        {draft.fields.map((field) => (
          <View key={field.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Field</Text>
              <Pressable
                onPress={() =>
                  setDraft((d) => ({
                    ...d,
                    fields: d.fields.filter((f) => f.id !== field.id),
                  }))
                }
              >
                <Text style={styles.linkDanger}>Remove</Text>
              </Pressable>
            </View>
            <TextInput
              value={field.key}
              onChangeText={(key) => patchField(field.id, { key })}
              placeholder="Key"
              placeholderTextColor={colors.hint}
              style={styles.input}
            />
            <TextInput
              value={field.value}
              onChangeText={(value) => patchField(field.id, { value })}
              placeholder="Value"
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
          <Text style={styles.secondaryText}>+ Add field</Text>
        </Pressable>

        <Pressable style={styles.primary} onPress={onSave}>
          <Text style={styles.primaryText}>Save</Text>
        </Pressable>

        {!isNew ? (
          <Pressable style={styles.deleteBtn} onPress={onDelete}>
            <Text style={styles.deleteText}>Delete contact</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <InteractiveBottomSheet
        open={!!picking}
        onDismiss={() => setKindPickerFor(null)}
        visibleFraction={0.55}
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetTitle}>TYPE</Text>
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
        </View>
      </InteractiveBottomSheet>
    </ScreenChrome>
  );
}

function placeholderForKind(kind: IdentifierKind): string {
  switch (kind) {
    case "ark":
      return "ark1…";
    case "onchain":
      return "bc1…";
    case "npub":
      return "npub1…";
    case "nip05":
      return "name@domain";
    case "lightning_address":
      return "user@domain";
    case "bip353":
      return "₿user@domain";
    case "lnurl":
      return "lnurl1… / https://…";
    default:
      return "value";
  }
}

const styles = StyleSheet.create({
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
    fontSize: 22,
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
  deleteBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  deleteText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
  },
  sheetBody: {
    paddingHorizontal: 20,
    paddingBottom: 16,
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
  },
  kindRowText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
});
