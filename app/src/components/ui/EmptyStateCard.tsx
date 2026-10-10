import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "../../theme/colors";
import { radii } from "../../theme/radii";

export type EmptyStateCardProps = {
  children: ReactNode;
  /** `default` = border fg; `muted` = border token. */
  variant?: "default" | "muted";
  style?: StyleProp<ViewStyle>;
};

/** Card shell for empty hubs — no shadow/elevation. */
export function EmptyStateCard({
  children,
  variant = "muted",
  style,
}: EmptyStateCardProps) {
  return (
    <View
      style={[
        styles.card,
        variant === "default" ? styles.borderFg : styles.borderMuted,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 16,
    marginTop: 12,
  },
  borderFg: { borderColor: colors.fg },
  borderMuted: { borderColor: colors.border },
});
