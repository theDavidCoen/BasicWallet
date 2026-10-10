import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

export type SectionHeaderProps = {
  children: string;
  /** First section in a list (tighter top margin). */
  first?: boolean;
  style?: StyleProp<TextStyle>;
};

/** Uppercase section label used in Settings hub. */
export function SectionHeader({ children, first, style }: SectionHeaderProps) {
  return (
    <Text style={[styles.section, first && styles.sectionFirst, style]}>{children}</Text>
  );
}

const styles = StyleSheet.create({
  section: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.hint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 28,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionFirst: { marginTop: 8 },
});
