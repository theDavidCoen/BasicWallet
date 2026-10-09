/**
 * Spotlight D Home onboarding tour overlay.
 *
 * Transparent Modal (new RN root) — must NOT be an AbsoluteFill sibling of
 * Home ScreenChrome (that crushed layout on Samsung in 0.9.6-rc.3).
 *
 * Card cluster is a fixed-width column (card → dots → Skip/Next). Nav sits
 * immediately under the card edges — never a full-screen footer.
 */

import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
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
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  HOME_TOUR_STEPS,
  type HomeTourStep,
} from "../home/homeTour";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";

const CARD_WIDTH = 300;
const STEP_COUNT = HOME_TOUR_STEPS.length;

type Props = {
  visible: boolean;
  stepIndex: number;
  onSkip: () => void;
  onNext: () => void;
};

/** Soft drifting arrow — no boxes, no chrome-sized chevrons. */
function SoftSwipeHint({ direction }: { direction: "ltr" | "rtl" }) {
  const x = useSharedValue(direction === "ltr" ? -28 : 28);
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    const from = direction === "ltr" ? -28 : 28;
    const to = direction === "ltr" ? 28 : -28;
    x.value = from;
    x.value = withRepeat(
      withSequence(
        withTiming(to, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(from, { duration: 0 }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 550 }),
        withTiming(0.25, { duration: 550 }),
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

  // Simple arrow path; flipped for RTL.
  const d =
    direction === "ltr"
      ? "M4 12 H20 M14 6 L20 12 L14 18"
      : "M20 12 H4 M10 6 L4 12 L10 18";

  return (
    <Animated.View style={[styles.swipeHint, style]} pointerEvents="none">
      <Svg width={36} height={24} viewBox="0 0 24 24">
        <Path
          d={d}
          fill="none"
          stroke={colors.fg}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Animated.View>
  );
}

function useSoftPulse() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.35, { duration: 800, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 800, easing: Easing.out(Easing.quad) }),
        withDelay(120, withTiming(0.45, { duration: 0 })),
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

function SoftPulse({
  top,
  left,
  right,
  center,
}: {
  top: number;
  left?: number;
  right?: number;
  center?: boolean;
}) {
  const style = useSoftPulse();
  if (center) {
    return (
      <View style={[styles.pulseCenterRow, { top }]} pointerEvents="none">
        <Animated.View style={[styles.pulseRing, style]} />
      </View>
    );
  }
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

function StepHints({ step, insetsTop }: { step: HomeTourStep; insetsTop: number }) {
  const headerY = Math.max(insetsTop, 12) + 8 + 10;
  // Keep swipe hint in the upper band (above the centered card), not over mid chrome.
  const swipeTop = headerY + 72;

  switch (step.hint) {
    case "swipe_ltr":
      return (
        <View style={[styles.swipeBand, { top: swipeTop }]} pointerEvents="none">
          <SoftSwipeHint direction="ltr" />
        </View>
      );
    case "swipe_rtl":
      return (
        <View style={[styles.swipeBand, { top: swipeTop }]} pointerEvents="none">
          <SoftSwipeHint direction="rtl" />
        </View>
      );
    case "pulse_settings":
      return <SoftPulse top={headerY} center />;
    case "pulse_avatar":
      return <SoftPulse top={headerY} left={28} />;
    case "pulse_fiat":
      return <SoftPulse top={headerY} right={28} />;
    default:
      return null;
  }
}

function TourBody({
  stepIndex,
  onSkip,
  onNext,
}: {
  stepIndex: number;
  onSkip: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const step = HOME_TOUR_STEPS[Math.max(0, Math.min(stepIndex, STEP_COUNT - 1))]!;
  const isLast = step.n >= STEP_COUNT;

  return (
    <View style={styles.portalRoot} pointerEvents="box-none">
      <Pressable
        style={styles.dim}
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel={t("home.tourSkip")}
      />

      <StepHints step={step} insetsTop={insets.top} />

      {/* Fixed-width cluster: card + dots + nav — never stretches to screen height. */}
      <View style={styles.centerStage} pointerEvents="box-none">
        <View style={styles.cluster} pointerEvents="box-none">
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
              style={styles.navBtnEnd}
            >
              <Text style={styles.navNext}>
                {isLast ? t("home.tourDone") : t("home.tourNext")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

export function HomeTourOverlay({ visible, stepIndex, onSkip, onNext }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onSkip}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <TourBody stepIndex={stepIndex} onSkip={onSkip} onNext={onNext} />
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  portalRoot: {
    flex: 1,
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  centerStage: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  /** Intrinsic height only — critical so Skip/Next stay under the card. */
  cluster: {
    width: CARD_WIDTH,
    maxWidth: "100%",
    flexGrow: 0,
    flexShrink: 0,
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
    marginTop: 12,
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
    marginTop: 12,
  },
  navBtn: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  navBtnEnd: {
    paddingVertical: 4,
    paddingLeft: 8,
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
  swipeBand: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeHint: {
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.25,
    borderColor: colors.fg,
  },
  pulseRingAbs: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.25,
    borderColor: colors.fg,
  },
  pulseCenterRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
