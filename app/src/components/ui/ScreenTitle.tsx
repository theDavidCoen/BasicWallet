import {
  StyleSheet,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

export type TextAlign = "center" | "left" | "right";

type TextBits = Pick<TextProps, "numberOfLines" | "ellipsizeMode" | "selectable">;

export type ScreenTitleProps = TextBits & {
  children: string;
  align?: TextAlign;
  style?: StyleProp<TextStyle>;
};

export function ScreenTitle({
  children,
  align = "center",
  style,
  ...rest
}: ScreenTitleProps) {
  return (
    <Text style={[styles.title, { textAlign: align }, style]} {...rest}>
      {children}
    </Text>
  );
}

export type CaptionProps = TextBits & {
  children: string;
  align?: TextAlign;
  style?: StyleProp<TextStyle>;
};

export function Caption({ children, align = "center", style, ...rest }: CaptionProps) {
  return (
    <Text style={[styles.caption, { textAlign: align }, style]} {...rest}>
      {children}
    </Text>
  );
}

export type HintProps = TextBits & {
  children: string;
  align?: TextAlign;
  style?: StyleProp<TextStyle>;
};

export function Hint({ children, align = "center", style, ...rest }: HintProps) {
  return (
    <Text style={[styles.hint, { textAlign: align }, style]} {...rest}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 12,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    lineHeight: 18,
  },
});
