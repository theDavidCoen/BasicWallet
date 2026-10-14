/**
 * Confirm / Deny add-contact after scanning a Nostr or contact QR.
 * Max height 50% of the window (visibleFraction 0.5).
 */

import { useMemo } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  findContactByIdentifierValue,
  upsertContact,
} from "../../contacts/contactStore";
import {
  contactFromScanToken,
  extractNpubFromScan,
} from "../../contacts/contactQr";
import { contactDisplayName, midEllipsis } from "../../contacts/types";
import { useI18n } from "../../i18n";
import { InteractiveBottomSheet } from "../sheet/InteractiveBottomSheet";
import { Button, Caption, ScreenTitle } from "../ui";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { sheetUi } from "../../theme/sheetUi";

export function AddContactFromQrSheet({
  open,
  scanToken,
  onDismiss,
}: {
  open: boolean;
  /** Raw QR / normalized token from scanner. */
  scanToken: string;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const draft = useMemo(
    () => (scanToken.trim() ? contactFromScanToken(scanToken) : null),
    [scanToken],
  );

  const previewName = draft ? contactDisplayName(draft) : "";
  const previewId =
    draft?.identifiers.find((i) => i.kind === "npub")?.value ??
    draft?.identifiers.find((i) => i.value.trim())?.value ??
    extractNpubFromScan(scanToken) ??
    "";

  function onConfirm() {
    if (!draft) {
      onDismiss();
      return;
    }
    const npub = draft.identifiers.find((i) => i.kind === "npub")?.value?.trim();
    if (npub) {
      const existing = findContactByIdentifierValue(npub);
      if (existing) {
        Alert.alert(
          t("contacts.qrAlreadySavedTitle"),
          t("contacts.qrAlreadySavedBody", { name: existing.name }),
        );
        onDismiss();
        return;
      }
    }
    try {
      upsertContact(draft);
      Alert.alert(
        t("contacts.qrAddedTitle"),
        t("contacts.qrAddedBody", { name: contactDisplayName(draft) }),
      );
    } catch (e) {
      Alert.alert(
        t("contacts.cannotSave"),
        e instanceof Error ? e.message : String(e),
      );
    }
    onDismiss();
  }

  return (
    <InteractiveBottomSheet
      open={open}
      onDismiss={onDismiss}
      visibleFraction={0.5}
      fitContent={false}
      portal
    >
      <View style={styles.body}>
        <ScreenTitle style={sheetUi.title}>{t("contacts.qrAddTitle")}</ScreenTitle>
        <Caption style={sheetUi.caption}>
          {previewName
            ? t("contacts.qrAddCaptionNamed", { name: previewName })
            : t("contacts.qrAddCaption")}
        </Caption>
        {previewId ? (
          <Text style={styles.id} numberOfLines={2}>
            {looksCompressed(previewId) ? previewId : midEllipsis(previewId, 12, 8)}
          </Text>
        ) : null}
        <Button size="sheet" onPress={onConfirm} disabled={!draft}>
          {t("contacts.qrConfirm")}
        </Button>
        <Button size="sheet" variant="secondary" onPress={onDismiss}>
          {t("contacts.qrDeny")}
        </Button>
      </View>
    </InteractiveBottomSheet>
  );
}

function looksCompressed(s: string): boolean {
  return s.includes("…");
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: 12,
  },
  id: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 16,
  },
});
