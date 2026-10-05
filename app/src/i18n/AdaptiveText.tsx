import { Text, type StyleProp, type TextProps, type TextStyle } from "react-native";
import { fitTextProps, scaleFontSize } from "./adaptiveFont";

type Props = TextProps & {
  /** When true (default), use adjustsFontSizeToFit for single-line shrink. */
  fit?: boolean;
  /** Optional pre-scale based on string length (combined with fit). */
  baseFontSize?: number;
  minScale?: number;
  style?: StyleProp<TextStyle>;
};

/**
 * Text that shrinks for longer IT/PT labels (CTAs, dense settings rows, Home actions).
 */
export function AdaptiveText({
  children,
  fit = true,
  baseFontSize,
  minScale = 0.72,
  style,
  numberOfLines,
  ...rest
}: Props) {
  const text = typeof children === "string" ? children : "";
  const scaled =
    baseFontSize != null && text
      ? scaleFontSize(text, { base: baseFontSize, minScale })
      : undefined;

  const fitProps = fit
    ? fitTextProps({
        numberOfLines: numberOfLines ?? 1,
        minimumFontScale: minScale,
      })
    : { numberOfLines };

  return (
    <Text
      {...rest}
      {...fitProps}
      style={[style, scaled != null ? { fontSize: scaled } : null]}
    >
      {children}
    </Text>
  );
}
