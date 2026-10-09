/**
 * Spotlight D Home onboarding tour overlay.
 *
 * Transparent Modal + GestureHandlerRootView (rc.5 — Skip/Next taps work on
 * Samsung). Never claim responder on the portal root (rc.7 dead controls).
 *
 * Card swipe uses RNGH Gesture.Pan on the card body only — PanResponder does
 * not receive moves inside GestureHandlerRootView on Samsung (rc.8). Skip/Next
 * stay TouchableOpacity outside the GestureDetector.
 *
 * Absolute cluster from window bottom: hint → card → dots → Skip/Next.
 * Hint is keyed by step so swipe/pulse swaps immediately with the copy.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
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
const SWIPE_THRESHOLD = 48;
/** Cluster bottom edge as a fraction of window height (under Chat & Pay). */
const CLUSTER_BOTTOM_FRAC = 0.14;

type Props = {
  visible: boolean;
  stepIndex: number;
  onSkip: () => void;
  onNext: () => void;
  onBack: () => void;
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

/**
 * Hint above the card — matches active step copy.
 * key={step.id} on the caller remounts so animations never linger across steps.
 */
function ClusterHint({ step }: { step: HomeTourStep }) {
  switch (step.hint) {
    case "swipe_ltr":
      return (
        <View style={styles.hintSlot} pointerEvents="none">
          <SoftSwipeHint direction="ltr" />
        </View>
      );
    case "swipe_rtl":
      return (
        <View style={styles.hintSlot} pointerEvents="none">
          <SoftSwipeHint direction="rtl" />
        </View>
      );
    case "pulse_settings":
    case "pulse_avatar":
    case "pulse_fiat":
      return (
        <View style={styles.hintSlot} pointerEvents="none">
          <SoftPulseHint />
        </View>
      );
    default:
      return <View style={styles.hintSlot} pointerEvents="none" />;
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
  const step = HOME_TOUR_STEPS[Math.max(0, Math.min(stepIndex, STEP_COUNT - 1))]!;
  const isLast = step.n >= STEP_COUNT;

  // Freeze window size on mount — do not reflow when Home rates/footer appear.
  const windowH = useMemo(() => Dimensions.get("window").height, []);
  const clusterBottom = Math.round(windowH * CLUSTER_BOTTOM_FRAC);

  const dragX = useSharedValue(0);
  const onNextRef = useRef(onNext);
  const onBackRef = useRef(onBack);
  onNextRef.current = onNext;
  onBackRef.current = onBack;

  const goNext = useCallback(() => {
    onNextRef.current();
  }, []);
  const goBack = useCallback(() => {
    onBackRef.current();
  }, []);

  // RNGH Pan on the card only (GH root owns the Modal window on Samsung).
  const cardSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20])
        .failOffsetY([-48, 48])
        .onUpdate((e) => {
          "worklet";
          dragX.value = e.translationX;
        })
        .onEnd((e) => {
          "worklet";
          const dx = e.translationX;
          dragX.value = withTiming(0, { duration: 120 });
          // ← Next · → Back (threshold ~48px)
          if (dx < -SWIPE_THRESHOLD) {
            runOnJS(goNext)();
          } else if (dx > SWIPE_THRESHOLD) {
            runOnJS(goBack)();
          }
        })
        .onFinalize(() => {
          "worklet";
          dragX.value = withTiming(0, { duration: 120 });
        }),
    [dragX, goBack, goNext],
  );

  const cardDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value * 0.35 }],
  }));

  return (
    <View style={styles.portalRoot}>
      <Pressable
        style={styles.dim}
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel={t("home.tourSkip")}
      />

      <View style={styles.stage} pointerEvents="box-none">
        <View
          style={[styles.cluster, { bottom: clusterBottom }]}
          collapsable={false}
          pointerEvents="box-none"
        >
          <ClusterHint key={step.id} step={step} />

          {/* Swipe target = card body only; nav buttons stay outside. */}
          <GestureDetector gesture={cardSwipe}>
            <Animated.View
              style={[styles.card, cardDragStyle]}
              accessible
              accessibilityRole="summary"
              accessibilityLabel={`${step.n}. ${t(step.titleKey)}`}
            >
              <Text style={styles.stepNum}>{step.n}</Text>
              <Text style={styles.title}>{t(step.titleKey)}</Text>
              <Text style={styles.body}>{t(step.bodyKey)}</Text>
            </Animated.View>
          </GestureDetector>

          <View style={styles.dotsRow} pointerEvents="none">
            {HOME_TOUR_STEPS.map((s) => (
              <View
                key={s.id}
                style={[styles.dot, s.n === step.n ? styles.dotActive : null]}
              />
            ))}
          </View>

          <View style={styles.navRow}>
            <TouchableOpacity
              onPress={onSkip}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              accessibilityRole="button"
              accessibilityLabel={t("home.tourSkip")}
              activeOpacity={0.6}
              style={styles.navBtn}
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onSkip}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GestureHandlerRootView style={styles.portalRoot}>
          <TourBody
            stepIndex={stepIndex}
            onSkip={onSkip}
            onNext={onNext}
            onBack={onBack}
          />
        </GestureHandlerRootView>
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
  hintSlot: {
    width: CARD_WIDTH,
    maxWidth: "100%",
    height: 40,
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
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
    paddingRight: 12,
    minWidth: 72,
  },
  navBtnEnd: {
    paddingVertical: 8,
    paddingLeft: 12,
    minWidth: 72,
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
});
