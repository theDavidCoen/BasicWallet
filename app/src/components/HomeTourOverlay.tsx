/**
 * Spotlight D Home onboarding tour overlay.
 *
 * Transparent Modal + GestureHandlerRootView (captures the Android window so
 * Home RNGH under the Modal cannot steal pans). Card cluster sits in the lower
 * Home void (below Chat & Pay). Horizontal swipe on the card uses RN
 * PanResponder (← Next / → Back) — RNGH Pan inside Modal conflicted with
 * TouchableOpacity on Samsung. Skip / Next / outside-tap = Skip remain.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
const SWIPE_THRESHOLD = 48;

type Props = {
  visible: boolean;
  stepIndex: number;
  onSkip: () => void;
  onNext: () => void;
  onBack: () => void;
};

/** Soft drifting arrow — no boxes, no chrome-sized chevrons. */
function SoftSwipeHint({ direction }: { direction: "ltr" | "rtl" }) {
  const x = useRef(new Animated.Value(direction === "ltr" ? -28 : 28)).current;
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const from = direction === "ltr" ? -28 : 28;
    const to = direction === "ltr" ? 28 : -28;
    x.setValue(from);
    const drift = Animated.loop(
      Animated.sequence([
        Animated.timing(x, {
          toValue: to,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(x, {
          toValue: from,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 550,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 550,
          useNativeDriver: true,
        }),
      ]),
    );
    drift.start();
    pulse.start();
    return () => {
      drift.stop();
      pulse.stop();
    };
  }, [direction, opacity, x]);

  const d =
    direction === "ltr"
      ? "M4 12 H20 M14 6 L20 12 L14 18"
      : "M20 12 H4 M10 6 L4 12 L10 18";

  return (
    <Animated.View
      style={[styles.swipeHint, { transform: [{ translateX: x }], opacity }]}
      pointerEvents="none"
    >
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
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.35,
            duration: 800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(120),
          Animated.timing(opacity, {
            toValue: 0.45,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, scale]);

  const ringStyle = {
    transform: [{ scale }],
    opacity,
  };

  if (center) {
    return (
      <View style={[styles.pulseCenterRow, { top }]} pointerEvents="none">
        <Animated.View style={[styles.pulseRing, ringStyle]} />
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
        ringStyle,
      ]}
    />
  );
}

function StepHints({ step, insetsTop }: { step: HomeTourStep; insetsTop: number }) {
  const headerY = Math.max(insetsTop, 12) + 8 + 10;
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
  onBack,
}: {
  stepIndex: number;
  onSkip: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const step = HOME_TOUR_STEPS[Math.max(0, Math.min(stepIndex, STEP_COUNT - 1))]!;
  const isLast = step.n >= STEP_COUNT;
  const dragX = useRef(new Animated.Value(0)).current;
  const onNextRef = useRef(onNext);
  const onBackRef = useRef(onBack);
  onNextRef.current = onNext;
  onBackRef.current = onBack;

  const cardPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
        onMoveShouldSetPanResponderCapture: (_, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
        onPanResponderGrant: () => {
          dragX.stopAnimation();
        },
        onPanResponderMove: (_, g) => {
          dragX.setValue(g.dx);
        },
        onPanResponderRelease: (_, g) => {
          const dx = g.dx;
          Animated.timing(dragX, {
            toValue: 0,
            duration: 120,
            useNativeDriver: true,
          }).start();
          // Swipe left (←) → Next · swipe right (→) → Back
          if (dx < -SWIPE_THRESHOLD) {
            onNextRef.current();
          } else if (dx > SWIPE_THRESHOLD) {
            onBackRef.current();
          }
        },
        onPanResponderTerminate: () => {
          Animated.timing(dragX, {
            toValue: 0,
            duration: 120,
            useNativeDriver: true,
          }).start();
        },
      }),
    [dragX],
  );

  // Sit in the lower void under Chat & Pay (not vertically centered).
  const stagePadBottom = Math.max(insets.bottom, 16) + 72;
  const stagePadTop = Math.round(windowH * 0.42);

  return (
    <View
      style={styles.portalRoot}
      // Claim the full Modal window so underlying Home never sees the touch.
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
    >
      <Pressable
        style={styles.dim}
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel={t("home.tourSkip")}
      />

      <StepHints step={step} insetsTop={insets.top} />

      <View
        style={[
          styles.centerStage,
          { paddingTop: stagePadTop, paddingBottom: stagePadBottom },
        ]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.cluster,
            { transform: [{ translateX: Animated.multiply(dragX, 0.35) }] },
          ]}
          collapsable={false}
          {...cardPan.panHandlers}
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
        </Animated.View>
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
  centerStage: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 24,
    zIndex: 2,
    elevation: 4,
  },
  cluster: {
    width: CARD_WIDTH,
    maxWidth: "100%",
    flexGrow: 0,
    flexShrink: 0,
    zIndex: 3,
    elevation: 6,
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
  swipeBand: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
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
    zIndex: 1,
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
});
