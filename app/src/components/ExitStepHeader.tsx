/**
 * Numbered step chrome for unilateral exit wizard (4 steps).
 */

import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";

export const EXIT_STEP_COUNT = 4;

export const EXIT_STEP = {
  recovery: 1,
  prepare: 2,
  fundFees: 3,
  execute: 4,
} as const;

type Props = {
  step: number;
  title: string;
  caption?: string;
};

export function ExitStepHeader({ step, title, caption }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.step}>
        STEP {step} OF {EXIT_STEP_COUNT}
      </Text>
      <Text style={styles.title}>{title}</Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  step: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 10,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "left",
    lineHeight: 19,
  },
});
