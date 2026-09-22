/**
 * Thin white bar under the status bar while the wallet is syncing.
 * Fills L→R, then fades out.
 */

import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BAR_H = 5;

export function SyncProgressBar({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);
  const [mounted, setMounted] = useState(false);
  const showingRef = useRef(false);

  useEffect(() => {
    if (active) {
      showingRef.current = true;
      setMounted(true);
      cancelAnimation(progress);
      cancelAnimation(opacity);
      opacity.value = 1;
      progress.value = 0;
      // Ease toward ~90% while syncing; finish jumps to 100% on deactivate.
      progress.value = withTiming(0.9, {
        duration: 12_000,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    if (!showingRef.current) return;
    showingRef.current = false;

    cancelAnimation(progress);
    progress.value = withTiming(
      1,
      { duration: 220, easing: Easing.out(Easing.quad) },
      (finished) => {
        if (!finished) return;
        opacity.value = withTiming(0, { duration: 180 }, (done) => {
          if (done) runOnJS(setMounted)(false);
        });
      },
    );
  }, [active, opacity, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.001, Math.min(1, progress.value)) }],
    opacity: opacity.value,
  }));

  if (!mounted) return null;

  return (
    <View
      style={[styles.track, { top: insets.top }]}
      pointerEvents="none"
      accessibilityElementsHidden
    >
      <Animated.View style={[styles.fill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    height: BAR_H,
    zIndex: 50,
    elevation: 50,
    overflow: "hidden",
  },
  fill: {
    height: BAR_H,
    width: "100%",
    backgroundColor: "#FFFFFF",
    transformOrigin: "left center",
  },
});
