import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

/** POS / ChatAmount / Receive pad layout (extracted from ReceivePosPanel). */
export const AMOUNT_KEYPAD_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["C", "0", "⌫"],
] as const;

export type AmountKeypadProps = {
  onKey: (key: string) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shared numeric pad used by Receive POS (and ChatAmount via that panel).
 * Hexes match the shipped pad (#333 / #2a2a2a / card fill) — not a restyle.
 */
export function AmountKeypad({ onKey, style }: AmountKeypadProps) {
  return (
    <View style={[styles.pad, style]}>
      {AMOUNT_KEYPAD_KEYS.map((row, ri) => (
        <View key={`r${ri}`} style={styles.padRow}>
          {row.map((label) => (
            <Pressable key={label} style={styles.key} onPress={() => onKey(label)}>
              <Text
                style={[
                  styles.keyLabel,
                  (label === "C" || label === "⌫") && styles.keyMuted,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    marginTop: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333",
    backgroundColor: colors.card,
    overflow: "hidden",
    flexGrow: 1,
    maxHeight: 340,
  },
  padRow: { flex: 1, flexDirection: "row" },
  key: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2a2a",
  },
  keyLabel: {
    fontFamily: fonts.bold,
    fontSize: 24,
    color: colors.fg,
  },
  keyMuted: {
    fontSize: 20,
    color: colors.caption,
  },
});
