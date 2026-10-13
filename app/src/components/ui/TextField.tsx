import {
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { colors } from "../../theme/colors";
import { radii } from "../../theme/radii";
import { fonts } from "../../theme/typography";

export type TextFieldProps = Omit<TextInputProps, "style"> & {
  error?: boolean;
  style?: StyleProp<TextStyle>;
};

/** Sheet/hub text input — border, radius sm, Mono 16. */
export function TextField({ error, style, placeholderTextColor, ...rest }: TextFieldProps) {
  return (
    <TextInput
      placeholderTextColor={placeholderTextColor ?? colors.hint}
      style={[styles.input, error && styles.inputError, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.fg,
    fontFamily: fonts.regular,
    fontSize: 16,
    marginBottom: 12,
  },
  inputError: {
    borderColor: colors.danger,
  },
});
