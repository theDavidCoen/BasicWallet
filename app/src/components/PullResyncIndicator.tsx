/**
 * Browser-like circular refresh arrow for Home pull-to-force-resync (α96).
 * Fades/rotates with pull distance; spins while forceResync is busy.
 * Uses Home chrome ink (colors.fg) on dark bg — not Material purple.
 */

import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../theme/colors";

const SIZE = 28;
const THRESHOLD = 72;

type Props = {
  /** Pull translationY (px), shared with the pan gesture. */
  pullY: SharedValue<number>;
  /** True while forceResync() is in flight. */
  busy: boolean;
};

export function PullResyncIndicator({ pullY, busy }: Props) {
  const spin = useSharedValue(0);
  const busyOpacity = useSharedValue(0);

  useEffect(() => {
    if (busy) {
      busyOpacity.value = withTiming(1, { duration: 120 });
      spin.value = 0;
      spin.value = withRepeat(
        withTiming(360, { duration: 850, easing: Easing.linear }),
        -1,
        false,
      );
      return;
    }
    cancelAnimation(spin);
    spin.value = withTiming(0, { duration: 120 });
    busyOpacity.value = withTiming(0, { duration: 180 });
  }, [busy, busyOpacity, spin]);

  const wrapStyle = useAnimatedStyle(() => {
    const pull = Math.max(0, pullY.value);
    const pullOpacity = interpolate(
      pull,
      [12, THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const opacity = Math.max(pullOpacity, busyOpacity.value);
    const translateY = interpolate(
      pull,
      [0, THRESHOLD],
      [-6, 10],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      pull,
      [0, THRESHOLD],
      [0.72, 1],
      Extrapolation.CLAMP,
    );
    // Pull rotates the arrow; busy spin takes over via spin shared value.
    const pullDeg = interpolate(
      pull,
      [0, THRESHOLD * 1.4],
      [0, 220],
      Extrapolation.CLAMP,
    );
    const spinning = busyOpacity.value > 0.5;
    const deg = spinning ? spin.value : pullDeg;
    return {
      opacity,
      transform: [
        { translateY: spinning ? 10 : translateY },
        { scale: spinning ? 1 : scale },
        { rotate: `${deg}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[styles.wrap, wrapStyle]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.disk}>
        <Svg width={SIZE} height={SIZE} viewBox="0 0 28 28">
          {/* Arc ring */}
          <Circle
            cx="14"
            cy="14"
            r="9"
            stroke={colors.fg}
            strokeWidth="2"
            fill="none"
            strokeDasharray="42 18"
            strokeLinecap="round"
          />
          {/* Arrow head */}
          <Path
            d="M20.5 7.5 L23.2 11.2 L19 12.1 Z"
            fill={colors.fg}
          />
        </Svg>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: -36,
    left: 0,
    right: 0,
    height: SIZE + 4,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  disk: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
