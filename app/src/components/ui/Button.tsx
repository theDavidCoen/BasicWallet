import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "../../theme/colors";
import { radii } from "../../theme/radii";
import { fonts } from "../../theme/typography";

export type ButtonVariant = "primary" | "secondary" | "danger";

export type ButtonProps = {
  children: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Replace label while busy (default: spinner). */
  busyContent?: ReactNode;
};

/**
 * Hub CTA — wraps `ui.primaryBtn` / `secondaryBtn` look with busy/disabled.
 * `danger` = primary fill with danger label color (soft destroy).
 */
export function Button({
  children,
  onPress,
  variant = "primary",
  busy,
  disabled,
  style,
  accessibilityLabel,
  busyContent,
}: ButtonProps) {
  const blocked = Boolean(busy || disabled);
  const isPrimary = variant === "primary" || variant === "danger";

  return (
    <Pressable
      style={[
        isPrimary ? styles.primary : styles.secondary,
        blocked && styles.busy,
        style,
      ]}
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: blocked, busy: Boolean(busy) }}
    >
      {busy ? (
        busyContent ?? (
          <ActivityIndicator color={isPrimary ? colors.onPrimary : colors.fg} />
        )
      ) : (
        <Text
          style={[
            isPrimary ? styles.primaryText : styles.secondaryText,
            variant === "danger" && styles.dangerText,
          ]}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: colors.fg,
    borderRadius: radii.sm,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  primaryText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.onPrimary,
  },
  secondary: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
    backgroundColor: "transparent",
  },
  secondaryText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.fg,
  },
  dangerText: {
    color: colors.danger,
  },
  busy: {
    opacity: 0.6,
  },
});
