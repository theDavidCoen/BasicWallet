/**
 * Shared contact list for Settings and Send → Enter sheet.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Contact } from "../../contacts/types";
import {
  contactDisplayName,
  contactInitials,
  kindPillLabel,
  midEllipsis,
  primaryIdentifier,
} from "../../contacts/types";
import { colors } from "../../theme/colors";

export function ContactPickList({
  contacts,
  onPick,
  emptyLabel = "No contacts yet",
}: {
  contacts: Contact[];
  onPick: (contact: Contact) => void;
  emptyLabel?: string;
}) {
  if (!contacts.length) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

  return (
    <View style={styles.list}>
      {contacts.map((c) => {
        const primary = primaryIdentifier(c);
        const extra = c.identifiers.length > 1 ? ` +${c.identifiers.length - 1}` : "";
        const title = contactDisplayName(c);
        return (
          <Pressable
            key={c.id}
            style={styles.row}
            onPress={() => onPick(c)}
            accessibilityRole="button"
            accessibilityLabel={`Contact ${title}`}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{contactInitials(c)}</Text>
            </View>
            <View style={styles.meta}>
              <Text style={styles.name} numberOfLines={1}>
                {title}
              </Text>
              <View style={styles.idRow}>
                {primary ? (
                  <>
                    <View style={styles.pill}>
                      <Text style={styles.pillText}>{kindPillLabel(primary)}</Text>
                    </View>
                    <Text style={styles.idValue} numberOfLines={1}>
                      {midEllipsis(primary.value, 10, 6)}
                      {extra}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.idValue}>No identifiers</Text>
                )}
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  empty: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    paddingVertical: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    marginBottom: 4,
  },
  idRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "#1A1A1A",
  },
  pillText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 9,
    color: colors.caption,
  },
  idValue: {
    flex: 1,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
  },
  chevron: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 18,
    color: colors.hint,
  },
});
