import Svg, { Path, Text as SvgText } from "react-native-svg";
import { Pressable, StyleSheet, View } from "react-native";

/** Hollow tilted ₿-as-B + `asic` — matches prototype/logo-basic.svg */
const B_PATH =
  "m46.103,27.444c0.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-0.875-1.4,5.616c-0.923-0.23-1.871-0.447-2.813-0.662l1.41-5.653-3.509-0.875-1.439,5.766c-0.764-0.174-1.514-0.346-2.242-0.527l0.004-0.018-4.842-1.209-0.934,3.75s2.605,0.597,2.55,0.634c1.422,0.355,1.679,1.296,1.636,2.042l-1.638,6.571c0.098,0.025,0.225,0.061,0.365,0.117-0.117-0.029-0.242-0.061-0.371-0.092l-2.296,9.205c-0.174,0.432-0.615,1.08-1.609,0.834,0.035,0.051-2.552-0.637-2.552-0.637l-1.743,4.019,4.569,1.139c0.85,0.213,1.683,0.436,2.503,0.646l-1.453,5.834,3.507,0.875,1.439-5.772c0.958,0.26,1.888,0.5,2.798,0.726l-1.434,5.745,3.511,0.875,1.453-5.823c5.987,1.133,10.489,0.676,12.384-4.739,1.527-4.36-0.076-6.875-3.226-8.515,2.294-0.529,4.022-2.038,4.483-5.155zm-8.022,11.249c-1.085,4.36-8.426,2.003-10.806,1.412l1.928-7.729c2.38,0.594,10.012,1.77,8.878,6.317zm1.086-11.312c-0.99,3.966-7.1,1.951-9.082,1.457l1.748-7.01c1.982,0.494,8.365,1.416,7.334,5.553z";

/**
 * Cropped to the inked wordmark (equal pad L/R). Pad must include stroke + the
 * B `translate(-6,-9)` or the ₿ clips on the left/top.
 */
const VIEW_X = 6;
const VIEW_Y = -10;
const VIEW_W = 122;
const VIEW_H = 62;

type Props = {
  onPress?: () => void;
  /** Penpot: Home ~1.0 · secondary ~0.77 · Onboarding Create ~1.7 */
  scale?: number;
};

export function BasicLogo({ onPress, scale = 1 }: Props) {
  const h = Math.round(VIEW_H * 0.55 * scale);
  const w = Math.round(VIEW_W * 0.55 * scale);

  const mark = (
    <View style={styles.wrap} accessibilityRole="image" accessibilityLabel="Basic">
      <Svg width={w} height={h} viewBox={`${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`}>
        {/* Penpot: B closer to “asic”, slightly above text baseline. */}
        <Path
          d={B_PATH}
          transform="translate(-6,-9) scale(1.05)"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={1.15}
          strokeLinejoin="miter"
          strokeMiterlimit={4}
        />
        <SvgText
          x={40}
          y={38}
          fill="#FFFFFF"
          fontFamily="JetBrainsMono_400Regular"
          fontSize={32}
          letterSpacing={0.5}
        >
          asic
        </SvgText>
      </Svg>
    </View>
  );

  if (!onPress) return mark;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Home"
      style={styles.wrap}
    >
      {mark}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    overflow: "visible",
  },
});
