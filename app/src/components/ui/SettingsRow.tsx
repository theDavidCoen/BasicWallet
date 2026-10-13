import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

export type SettingsRowProps = {
  label: string;
  onPress?: () => void;
  /** Soft destroy / caution label color. */
  danger?: boolean;
  disabled?: boolean;
  /** Override trailing content (default ›). */
  right?: ReactNode;
  /** Subtitle under label (Privacy-style detail rows). */
  hint?: string;
  /** Show “soon” (or custom) instead of chevron. */
  stub?: boolean;
  stubLabel?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * Settings hub row: label + › + hairline.
 * With `hint`, uses Privacy detail typography (label 15 + hint 12).
 */
export function SettingsRow({
  label,
  onPress,
  danger,
  disabled,
  right,
  hint,
  stub,
  stubLabel,
  style,
  accessibilityLabel,
}: SettingsRowProps) {
  const detail = Boolean(hint);
  const trailing =
    right !== undefined ? (
      right
    ) : (
      <Text
        style={[
          detail ? styles.chevronDetail : styles.chevron,
          danger && styles.dangerLabel,
        ]}
      >
        {stub ? stubLabel ?? "soon" : "›"}
      </Text>
    );

  return (
    <Pressable
      style={[styles.row, style]}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      {detail ? (
        <View style={styles.rowText}>
          <Text style={[styles.labelDetail, danger && styles.dangerLabel]}>{label}</Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
      ) : (
        <Text style={[styles.rowLabel, danger && styles.dangerLabel]}>{label}</Text>
      )}
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.fg,
    flex: 1,
    paddingRight: 12,
  },
  rowText: { flex: 1 },
  labelDetail: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.fg,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.hint,
    marginTop: 4,
    lineHeight: 16,
  },
  chevron: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.caption,
  },
  chevronDetail: {
    fontFamily: fonts.regular,
    fontSize: 18,
    color: colors.hint,
  },
  dangerLabel: { color: colors.danger },
});
