/**
 * Spotlight D Home onboarding tour overlay.
 * Centered numbered card · dots under card · Skip/Next aligned to card edges ·
 * tap outside = Skip · soft swipe / tap-pulse hints on Home chrome.
 */

import { useEffect } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  HOME_TOUR_STEPS,
  type HomeTourStep,
} from "../home/homeTour";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";

const CARD_WIDTH = 300;
const STEP_COUNT = HOME_TOUR_STEPS.length;

type Props = {
  stepIndex: number;
  onSkip: () => void;
  onNext: () => void;
};

function SwipeHint({ direction }: { direction: "ltr" | "rtl" }) {
  const x = useSharedValue(direction === "ltr" ? -36 : 36);
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    const from = direction === "ltr" ? -40 : 40;
    const to = direction === "ltr" ? 40 : -40;
    x.value = from;
    opacity.value = 0.25;
    x.value = withRepeat(
      withSequence(
        withTiming(to, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(from, { duration: 0 }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.95, { duration: 450 }),
        withTiming(0.25, { duration: 450 }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(x);
      cancelAnimation(opacity);
    };
  }, [direction, opacity, x]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.swipeHint, style]} pointerEvents="none">
      <Text style={styles.swipeChevrons}>
        {direction === "ltr" ? "› › ›" : "‹ ‹ ‹"}
      </Text>
    </Animated.View>
  );
}

function usePulseAnim() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    scale.value = 1;
    opacity.value = 0.55;
    scale.value = withRepeat(
      withSequence(
        withTiming(1.55, { duration: 700, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 700, easing: Easing.out(Easing.quad) }),
        withDelay(80, withTiming(0.55, { duration: 0 })),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [opacity, scale]);

  return useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
}

function PulseRing({
  top,
  left,
  right,
}: {
  top: number;
  left?: number;
  right?: number;
}) {
  const style = usePulseAnim();
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulseRingAbs,
        { top },
        left != null ? { left } : null,
        right != null ? { right } : null,
        style,
      ]}
    />
  );
}

function PulseRingInline() {
  const style = usePulseAnim();
  return <Animated.View pointerEvents="none" style={[styles.pulseRing, style]} />;
}

function StepHints({ step, insetsTop }: { step: HomeTourStep; insetsTop: number }) {
  const headerY = Math.max(insetsTop, 12) + 8 + 10;

  switch (step.hint) {
    case "swipe_ltr":
      return (
        <View style={styles.swipeZone} pointerEvents="none">
          <SwipeHint direction="ltr" />
        </View>
      );
    case "swipe_rtl":
      return (
        <View style={styles.swipeZone} pointerEvents="none">
          <SwipeHint direction="rtl" />
        </View>
      );
    case "pulse_settings":
      // Soft pulse over empty header / logo zone (long-press target).
      return (
        <View style={[styles.pulseCenterRow, { top: headerY }]} pointerEvents="none">
          <PulseRingInline />
        </View>
      );
    case "pulse_avatar":
      return <PulseRing top={headerY} left={28} />;
    case "pulse_fiat":
      return <PulseRing top={headerY} right={28} />;
    default:
      return null;
  }
}

export function HomeTourOverlay({ stepIndex, onSkip, onNext }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const step = HOME_TOUR_STEPS[Math.max(0, Math.min(stepIndex, STEP_COUNT - 1))]!;
  const isLast = step.n >= STEP_COUNT;
  const cardEnter = useSharedValue(0);

  useEffect(() => {
    cardEnter.value = 0;
    cardEnter.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [cardEnter, step.n]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: cardEnter.value,
    transform: [{ translateY: (1 - cardEnter.value) * 10 }],
  }));

  return (
    <View
      style={[styles.root, { minHeight: windowH }]}
      pointerEvents="box-none"
      accessibilityViewIsModal
    >
      {/* Soft dim — tap = Skip */}
      <Pressable
        style={styles.dim}
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel={t("home.tourSkip")}
      />

      <StepHints step={step} insetsTop={insets.top} />

      <View style={styles.centerColumn} pointerEvents="box-none">
        <Animated.View style={[styles.cardWrap, cardAnim]}>
          <View
            style={styles.card}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={`${step.n}. ${t(step.titleKey)}`}
          >
            <Text style={styles.stepNum}>{step.n}</Text>
            <Text style={styles.title}>{t(step.titleKey)}</Text>
            <Text style={styles.body}>{t(step.bodyKey)}</Text>
          </View>

          <View style={styles.dotsRow} pointerEvents="none">
            {HOME_TOUR_STEPS.map((s) => (
              <View
                key={s.id}
                style={[styles.dot, s.n === step.n ? styles.dotActive : null]}
              />
            ))}
          </View>

          <View style={styles.navRow}>
            <Pressable
              onPress={onSkip}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("home.tourSkip")}
              style={styles.navBtn}
            >
              <Text style={styles.navSkip}>{t("home.tourSkip")}</Text>
            </Pressable>
            <Pressable
              onPress={onNext}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={isLast ? t("home.tourDone") : t("home.tourNext")}
              style={[styles.navBtn, styles.navBtnRight]}
            >
              <Text style={styles.navNext}>
                {isLast ? t("home.tourDone") : t("home.tourNext")}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
    elevation: 200,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  centerColumn: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  cardWrap: {
    width: CARD_WIDTH,
    maxWidth: "100%",
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.fg,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },
  stepNum: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 8,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
    marginBottom: 10,
  },
  body: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    lineHeight: 20,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "transparent",
  },
  dotActive: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    width: "100%",
  },
  navBtn: {
    minWidth: 72,
    paddingVertical: 6,
  },
  navBtnRight: {
    alignItems: "flex-end",
  },
  navSkip: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
  },
  navNext: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  swipeZone: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 80,
  },
  swipeHint: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  swipeChevrons: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 28,
    color: colors.fg,
    letterSpacing: 4,
  },
  pulseRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.fg,
  },
  pulseRingAbs: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.fg,
  },
  pulseCenterRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
