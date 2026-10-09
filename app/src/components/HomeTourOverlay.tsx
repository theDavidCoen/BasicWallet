/**
 * Spotlight D Home onboarding tour overlay.
 *
 * No GestureHandlerRootView in this Modal — a second GH root on Samsung fought
 * Home's RNGH (dead card swipe in rc.8–rc.9, freeze after dismiss on POS swipe).
 * Skip/Next/dim use RN Pressable/TouchableOpacity (rc.5 pattern without GH).
 *
 * Card swipe: RN responder on the card body only (pageX delta, ~48px). No
 * PanResponder, no RNGH Pan. Buttons stay outside the swipe target.
 *
 * Cluster pinned with frozen window metrics (top = % of window height) so
 * rates/footer/Chat&Pay cannot shift it: hint → card → dots → Skip/Next.
 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
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
/**
 * Top edge of the cluster as a fraction of window height.
 * Frozen at mount — independent of Home content / rates / safe-area settle.
 * ~0.52 keeps hint+card in the lower void under Chat & Pay on phones.
 */
const CLUSTER_TOP_FRAC = 0.52;

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

/** Minimal horizontal swipe on the card — RN responders only (no RNGH / PanResponder). */
function SwipeCard({
  onNext,
  onBack,
  accessibilityLabel,
  children,
}: {
  onNext: () => void;
  onBack: () => void;
  accessibilityLabel: string;
  children: ReactNode;
}) {
  const origin = useRef<{ x: number; y: number } | null>(null);

  const onGrant = (e: GestureResponderEvent) => {
    origin.current = {
      x: e.nativeEvent.pageX,
      y: e.nativeEvent.pageY,
    };
  };

  const onRelease = (e: GestureResponderEvent) => {
    const start = origin.current;
    origin.current = null;
    if (!start) return;
    const dx = e.nativeEvent.pageX - start.x;
    const dy = e.nativeEvent.pageY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
    if (dx < 0) onNext();
    else onBack();
  };

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      collapsable={false}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={onGrant}
      onResponderRelease={onRelease}
      onResponderTerminate={() => {
        origin.current = null;
      }}
    >
      {children}
    </View>
  );
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

  // Freeze once — never recompute when Home rates/footer appear under the dim.
  const clusterTop = useMemo(() => {
    const windowH = Dimensions.get("window").height;
    return Math.round(windowH * CLUSTER_TOP_FRAC);
  }, []);

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
          style={[styles.cluster, { top: clusterTop }]}
          collapsable={false}
          pointerEvents="box-none"
        >
          <ClusterHint key={step.id} step={step} />

          <SwipeCard
            onNext={onNext}
            onBack={onBack}
            accessibilityLabel={`${step.n}. ${t(step.titleKey)}`}
          >
            <Text style={styles.stepNum}>{step.n}</Text>
            <Text style={styles.title}>{t(step.titleKey)}</Text>
            <Text style={styles.body}>{t(step.bodyKey)}</Text>
          </SwipeCard>

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
      {/* No GestureHandlerRootView — keep Modal on the RN touch system only. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <TourBody
          stepIndex={stepIndex}
          onSkip={onSkip}
          onNext={onNext}
          onBack={onBack}
        />
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
