/**
 * Review a shared contact: add to directory or refuse.
 */

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, ScreenTitle } from "../components/ui";
import { sharedPayloadToContact } from "../contacts/contactShare";
import {
  dismissContactShareOffer,
  getContactShareOffer,
  type ContactShareOffer,
} from "../contacts/contactShareInbox";
import { upsertContact } from "../contacts/contactStore";
import {
  contactDisplayName,
  contactInitials,
  kindPillLabel,
  midEllipsis,
} from "../contacts/types";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";

export function ContactShareOfferScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ContactShareOffer">>();
  const { t } = useI18n();
  const offerId = route.params.offerId;

  const [offer, setOffer] = useState<ContactShareOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void (async () => {
      setLoading(true);
      const o = await getContactShareOffer(offerId);
      setOffer(o);
      setLoading(false);
    })();
  }, [offerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function finishAndLeave() {
    await dismissContactShareOffer(offerId);
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Home");
  }

  async function onAdd() {
    if (!offer || busy) return;
    setBusy(true);
    try {
      const contact = sharedPayloadToContact(offer.contact);
      upsertContact(contact);
      await finishAndLeave();
    } catch (e) {
      setBusy(false);
      console.warn("[basic] accept contact share failed", e);
    }
  }

  async function onRefuse() {
    if (busy) return;
    setBusy(true);
    try {
      await finishAndLeave();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <ScreenChrome logoScale={0.77}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.fg} />
        </View>
      </ScreenChrome>
    );
  }

  if (!offer) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ScreenTitle>{t("contacts.shareTitle")}</ScreenTitle>
        <Caption>{t("contacts.shareUnavailable")}</Caption>
        <Button onPress={() => navigation.navigate("Home")}>{t("contacts.home")}</Button>
      </ScreenChrome>
    );
  }

  const name = contactDisplayName(offer.contact);
  const initials = contactInitials(offer.contact);
  const fromLabel =
    offer.fromDisplayName?.trim() || midEllipsis(offer.fromNpub, 12, 6);

  return (
    <ScreenChrome logoScale={0.77}>
      <ScreenTitle>{t("contacts.shareTitle")}</ScreenTitle>
      <Caption>{t("contacts.from", { who: fromLabel })}</Caption>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>{name}</Text>
          {offer.contact.note ? (
            <Text style={styles.note}>{offer.contact.note}</Text>
          ) : null}

          {offer.contact.identifiers.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("contacts.identifiers")}</Text>
              {offer.contact.identifiers.map((ident, idx) => (
                <View key={`${ident.kind}-${idx}`} style={styles.row}>
                  <Text style={styles.pill}>{kindPillLabel({ ...ident, id: String(idx) })}</Text>
                  <Text style={styles.value} numberOfLines={2}>
                    {ident.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {offer.contact.fields.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("contacts.fields")}</Text>
              {offer.contact.fields.map((f, idx) => (
                <View key={`${f.key}-${idx}`} style={styles.row}>
                  <Text style={styles.pill}>{f.key || t("contacts.fieldFallback")}</Text>
                  <Text style={styles.value} numberOfLines={2}>
                    {f.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <Button busy={busy} onPress={() => void onAdd()}>
          {t("contacts.addContactCta")}
        </Button>

        <Pressable
          style={styles.refuseHit}
          disabled={busy}
          onPress={() => void onRefuse()}
          accessibilityRole="button"
          accessibilityLabel={t("contacts.refuseA11y")}
        >
          <Text style={styles.refuseText}>{t("contacts.refuse")}</Text>
        </Pressable>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
    backgroundColor: colors.card,
    marginBottom: 20,
  },
  avatar: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
  },
  name: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 8,
  },
  note: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 17,
  },
  section: { marginTop: 8 },
  sectionTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 8,
  },
  row: {
    marginBottom: 10,
  },
  pill: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginBottom: 2,
  },
  value: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
  refuseHit: {
    alignItems: "center",
    paddingVertical: 16,
    marginTop: 4,
  },
  refuseText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: "#E07070",
  },
});
