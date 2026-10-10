import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n";
import { colors } from "../../theme/colors";

/**
 * One-time recipient card: add this inbound peer to Contacts, or deny.
 * Visual language matches ChatRequestCard (system-style inbound card).
 */
export function ChatInviteCard({
  peerName,
  onAdd,
  onDeny,
}: {
  peerName: string;
  onAdd: () => void;
  onDeny: () => void;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{t("chat.inviteKicker")}</Text>
      <Text style={styles.title}>
        {t("chat.inviteTitle", { name: peerName })}
      </Text>
      <Text style={styles.body}>{t("chat.inviteBody")}</Text>
      <View style={styles.actions}>
        <Pressable
          style={styles.denyBtn}
          onPress={onDeny}
          accessibilityRole="button"
          accessibilityLabel={t("chat.inviteDeny")}
        >
          <Text style={styles.denyText}>{t("chat.inviteDeny")}</Text>
        </Pressable>
        <Pressable
          style={styles.addBtn}
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={t("chat.inviteAdd")}
        >
          <Text style={styles.addText}>{t("chat.inviteAdd")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: "94%",
    width: "94%",
    alignSelf: "flex-start",
    borderRadius: 12,
    padding: 14,
    marginVertical: 6,
    marginHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  kicker: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    marginBottom: 6,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
  },
  body: {
    marginTop: 8,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    lineHeight: 17,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  denyBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: "center",
  },
  denyText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  addBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.fg,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  addText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: "#000",
  },
});
