import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { colors } from "../theme/colors";

type Props = Omit<TextInputProps, "secureTextEntry"> & {
  value: string;
  onChangeText: (text: string) => void;
};

function EyeIcon({ open }: { open: boolean }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
      {open ? (
        <>
          <Ellipse
            cx={12}
            cy={12}
            rx={9}
            ry={5.5}
            fill="none"
            stroke={colors.fg}
            strokeWidth={1.6}
          />
          <Circle cx={12} cy={12} r={2.4} fill={colors.fg} />
        </>
      ) : (
        <>
          <Ellipse
            cx={12}
            cy={12}
            rx={9}
            ry={5.5}
            fill="none"
            stroke={colors.hint}
            strokeWidth={1.6}
          />
          <Circle cx={12} cy={12} r={2.4} fill={colors.hint} />
          <Path
            d="M4 20 L20 4"
            stroke={colors.hint}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}

/** Passphrase field with eye toggle to verify typing. */
export function PassphraseInput({ value, onChangeText, style, ...rest }: Props) {
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.wrap}>
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!revealed}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, style]}
        placeholderTextColor={rest.placeholderTextColor ?? colors.hint}
      />
      <Pressable
        onPress={() => setRevealed((v) => !v)}
        hitSlop={10}
        style={styles.eyeBtn}
        accessibilityRole="button"
        accessibilityLabel={revealed ? "Hide passphrase" : "Reveal passphrase"}
      >
        <EyeIcon open={revealed} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    paddingRight: 48,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
  },
  eyeBtn: {
    position: "absolute",
    right: 12,
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
});
