/**
 * Spotlight D Home onboarding tour overlay.
 *
 * AbsoluteFill sibling of homeSwipe (App GH root). No card pan — Back / Skip /
 * Next under the card. Gesture hints sit on Home chrome (edges / header), not
 * on the card. Cluster pinned with frozen window top %. Instant step changes.
 */

import { useEffect, useMemo } from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
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
import Svg, { Path } from "react-native-svg";
import {
  HOME_TOUR_STEPS,
  type HomeTourStep,
} from "../home/homeTour";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";

const CARD_WIDTH = 300;
const STEP_COUNT = HOME_TOUR_STEPS.length;
/** Top of card cluster — frozen window fraction (under Chat & Pay void). */
const CLUSTER_TOP_FRAC = 0.52;

type Props = {
  visible: boolean;
  stepIndex: number;
  onSkip: () => void;
  onNext: () => void;
  onBack: () => void;
};

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

  const d =
    direction === "ltr"
      ? "M4 12 H20 M14 6 L20 12 L14 18"
      : "M20 12 H4 M10 6 L4 12 L10 18";

  return (
    <Animated.View style={[styles.hintAnim, style]} pointerEvents="none">
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

function SoftPulseHint() {
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

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.pulseRing, style]} pointerEvents="none" />
  );
}

/** Hints on Home chrome — not on the card cluster. */
function ChromeHints({
  step,
  insetsTop,
}: {
  step: HomeTourStep;
  insetsTop: number;
}) {
  const headerY = Math.max(insetsTop, 12) + 8;
  /** Center under Basic logo (avatar/logo/R$ row). */
  const logoPulseTop = headerY + 4;
  /** Soft swipe band in upper Home (balance / edge-swipe zone), above card. */
  const swipeTop = headerY + 96;

  switch (step.hint) {
    case "swipe_ltr":
      return (
        <View
          style={[styles.swipeBand, { top: swipeTop }]}
          pointerEvents="none"
        >
          <SoftSwipeHint direction="ltr" />
        </View>
      );
    case "swipe_rtl":
      return (
        <View
          style={[styles.swipeBand, { top: swipeTop }]}
          pointerEvents="none"
        >
          <SoftSwipeHint direction="rtl" />
        </View>
      );
    case "pulse_settings":
      return (
        <View style={[styles.pulseCenterRow, { top: logoPulseTop }]} pointerEvents="none">
          <SoftPulseHint />
        </View>
      );
    case "pulse_avatar":
      return (
        <View
          style={[styles.pulseAbs, { top: logoPulseTop, left: 20 }]}
          pointerEvents="none"
        >
          <SoftPulseHint />
        </View>
      );
    case "pulse_fiat":
      return (
        <View
          style={[styles.pulseAbs, { top: logoPulseTop, right: 20 }]}
          pointerEvents="none"
        >
          <SoftPulseHint />
        </View>
      );
    default:
      return null;
  }
}

function TourBody({
  stepIndex,
  onSkip,
  onNext,
  onBack,
}: {
  stepIndex: number;
  onSkip: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const step = HOME_TOUR_STEPS[Math.max(0, Math.min(stepIndex, STEP_COUNT - 1))]!;
  const isFirst = step.n <= 1;
  const isLast = step.n >= STEP_COUNT;

  const clusterTop = useMemo(() => {
    const windowH = Dimensions.get("window").height;
    return Math.round(windowH * CLUSTER_TOP_FRAC);
  }, []);

  return (
    <View style={styles.portalRoot} pointerEvents="box-none">
      <Pressable
        style={styles.dim}
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel={t("home.tourSkip")}
      />

      <ChromeHints key={step.id} step={step} insetsTop={insets.top} />

      <View style={styles.stage} pointerEvents="box-none">
        <View
          style={[styles.cluster, { top: clusterTop }]}
          collapsable={false}
          pointerEvents="box-none"
        >
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
            {isFirst ? (
              <View style={styles.navBtn} />
            ) : (
              <TouchableOpacity
                onPress={onBack}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                accessibilityRole="button"
                accessibilityLabel={t("home.tourBack")}
                activeOpacity={0.6}
                style={styles.navBtn}
              >
                <Text style={styles.navBack}>{t("home.tourBack")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onSkip}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t("home.tourSkip")}
              activeOpacity={0.6}
              style={styles.navBtnCenter}
            >
              <Text style={styles.navSkip}>{t("home.tourSkip")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onNext}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              accessibilityRole="button"
              accessibilityLabel={isLast ? t("home.tourDone") : t("home.tourNext")}
              activeOpacity={0.6}
              style={styles.navBtnEnd}
            >
              <Text style={styles.navNext}>
                {isLast ? t("home.tourDone") : t("home.tourNext")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

export function HomeTourOverlay({
  visible,
  stepIndex,
  onSkip,
  onNext,
  onBack,
}: Props) {
  if (!visible) return null;
  return (
    <View style={styles.host} pointerEvents="box-none">
      <TourBody
        stepIndex={stepIndex}
        onSkip={onSkip}
        onNext={onNext}
        onBack={onBack}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 500,
    elevation: 500,
  },
  portalRoot: {
    flex: 1,
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
    zIndex: 0,
  },
  stage: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
    elevation: 4,
  },
  cluster: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 24,
    width: "100%",
    zIndex: 3,
    elevation: 6,
  },
  card: {
    width: CARD_WIDTH,
    maxWidth: "100%",
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
    width: CARD_WIDTH,
    maxWidth: "100%",
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
    width: CARD_WIDTH,
    maxWidth: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  navBtn: {
    paddingVertical: 8,
    paddingRight: 8,
    minWidth: 64,
  },
  navBtnCenter: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    minWidth: 64,
    alignItems: "center",
  },
  navBtnEnd: {
    paddingVertical: 8,
    paddingLeft: 8,
    minWidth: 64,
    alignItems: "flex-end",
  },
  navBack: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
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
    zIndex: 1,
  },
  hintAnim: {
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
  pulseCenterRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  pulseAbs: {
    position: "absolute",
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
});
