/**
 * Spotlight D Home onboarding tour overlay.
 *
 * AbsoluteFill sibling of homeSwipe. No card pan — Back / Skip / Next.
 * Step index is owned here so Next/Back do not re-render HomeScreen.
 * Chrome hints stay mounted (opacity toggle) to avoid Reanimated remount hitch.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
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
const CLUSTER_TOP_FRAC = 0.52;

/** Ignore presses for this long after mount (touch bleed from prior screen). */
const TOUR_ARM_MS = 480;
/** Dim dismiss only if finger moves less than this (swipe ≠ Skip). */
const DIM_TAP_SLOP_PX = 12;

type Props = {
  visible: boolean;
  onSkip: () => void;
  /** Last-step Next / Done — parent releases locks + marks done. */
  onDone: () => void;
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

/** All hint trees stay mounted; only opacity flips per step (no Reanimated remount). */
function ChromeHints({
  hint,
  insetsTop,
}: {
  hint: HomeTourStep["hint"];
  insetsTop: number;
}) {
  const headerY = Math.max(insetsTop, 12) + 8;
  const logoPulseTop = headerY + 4;
  const swipeTop = headerY + 96;

  return (
    <>
      <View
        style={[
          styles.swipeBand,
          { top: swipeTop, opacity: hint === "swipe_ltr" ? 1 : 0 },
        ]}
        pointerEvents="none"
      >
        <SoftSwipeHint direction="ltr" />
      </View>
      <View
        style={[
          styles.swipeBand,
          { top: swipeTop, opacity: hint === "swipe_rtl" ? 1 : 0 },
        ]}
        pointerEvents="none"
      >
        <SoftSwipeHint direction="rtl" />
      </View>
      <View
        style={[
          styles.pulseCenterRow,
          { top: logoPulseTop, opacity: hint === "pulse_settings" ? 1 : 0 },
        ]}
        pointerEvents="none"
      >
        <SoftPulseHint />
      </View>
      <View
        style={[
          styles.pulseAbs,
          {
            top: logoPulseTop,
            left: 20,
            opacity: hint === "pulse_avatar" ? 1 : 0,
          },
        ]}
        pointerEvents="none"
      >
        <SoftPulseHint />
      </View>
      <View
        style={[
          styles.pulseAbs,
          {
            top: logoPulseTop,
            right: 20,
            opacity: hint === "pulse_fiat" ? 1 : 0,
          },
        ]}
        pointerEvents="none"
      >
        <SoftPulseHint />
      </View>
    </>
  );
}

/**
 * Instant press via onTouchStart (fires before Pressable press state machine).
 * Armed gate blocks Ready/backup touch bleed on first open.
 */
function TourPress({
  onPress,
  label,
  style,
  textStyle,
  children,
  armed,
}: {
  onPress: () => void;
  label: string;
  style?: object;
  textStyle: object;
  children: string;
  armed: boolean;
}) {
  return (
    <Pressable
      onTouchStart={() => {
        if (!armed) return;
        onPress();
      }}
      hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={style}
      android_disableSound
      unstable_pressDelay={0}
    >
      <Text style={textStyle}>{children}</Text>
    </Pressable>
  );
}

/**
 * Outside dismiss: only a deliberate tap. Swipes / pans / cancelled touches
 * must never Skip (rc.15: card pan fell through pointerEvents=none → dim onPress).
 */
function DimTapSkip({
  armed,
  onSkip,
  label,
}: {
  armed: boolean;
  onSkip: () => void;
  label: string;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  return (
    <View
      style={styles.dim}
      pointerEvents={armed ? "auto" : "none"}
      accessibilityRole="button"
      accessibilityLabel={label}
      onTouchStart={(e) => {
        const { pageX, pageY } = e.nativeEvent;
        start.current = { x: pageX, y: pageY };
        moved.current = false;
      }}
      onTouchMove={(e) => {
        if (!start.current || moved.current) return;
        const { pageX, pageY } = e.nativeEvent;
        const dx = pageX - start.current.x;
        const dy = pageY - start.current.y;
        if (dx * dx + dy * dy > DIM_TAP_SLOP_PX * DIM_TAP_SLOP_PX) {
          moved.current = true;
        }
      }}
      onTouchEnd={() => {
        const ok = armed && start.current != null && !moved.current;
        start.current = null;
        if (ok) onSkip();
      }}
      onTouchCancel={() => {
        start.current = null;
        moved.current = true;
      }}
    />
  );
}

function TourBody({
  onSkip,
  onDone,
}: {
  onSkip: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const [armed, setArmed] = useState(false);
  const pressT0 = useRef(0);

  useEffect(() => {
    setArmed(false);
    const id = setTimeout(() => setArmed(true), TOUR_ARM_MS);
    return () => clearTimeout(id);
  }, []);

  const step =
    HOME_TOUR_STEPS[Math.max(0, Math.min(stepIndex, STEP_COUNT - 1))]!;
  const isFirst = step.n <= 1;
  const isLast = step.n >= STEP_COUNT;

  useEffect(() => {
    const dt = pressT0.current ? Date.now() - pressT0.current : -1;
    console.log(
      `[HomeTour] step=${stepIndex} id=${step.id} paintDtMs=${dt}`,
    );
  }, [step.id, stepIndex]);

  const clusterTop = useMemo(() => {
    const windowH = Dimensions.get("window").height;
    return Math.round(windowH * CLUSTER_TOP_FRAC);
  }, []);

  const goNext = () => {
    pressT0.current = Date.now();
    console.log(`[HomeTour] press next at=${pressT0.current}`);
    setStepIndex((prev) => {
      if (prev >= STEP_COUNT - 1) {
        // Defer parent unlock so this press returns before Home re-renders.
        queueMicrotask(() => onDone());
        return prev;
      }
      return prev + 1;
    });
  };

  const goBack = () => {
    pressT0.current = Date.now();
    console.log(`[HomeTour] press back at=${pressT0.current}`);
    setStepIndex((prev) => Math.max(0, prev - 1));
  };

  const goSkip = () => {
    pressT0.current = Date.now();
    console.log(`[HomeTour] press skip at=${pressT0.current}`);
    queueMicrotask(() => onSkip());
  };

  return (
    <View style={styles.portalRoot} pointerEvents="box-none">
      <DimTapSkip
        armed={armed}
        onSkip={goSkip}
        label={t("home.tourSkip")}
      />

      <ChromeHints hint={step.hint} insetsTop={insets.top} />

      <View style={styles.stage} pointerEvents="box-none">
        <View
          style={[styles.cluster, { top: clusterTop }]}
          collapsable={false}
          pointerEvents="box-none"
        >
          {/* Absorb pans on the card — never let them hit the dim Skip. */}
          <View
            style={styles.card}
            pointerEvents="auto"
            accessible
            accessibilityRole="summary"
            accessibilityLabel={`${step.n}. ${t(step.titleKey)}`}
          >
            <Text style={styles.stepNum}>{step.n}</Text>
            <Text style={styles.title}>{t(step.titleKey)}</Text>
            <Text style={styles.body}>{t(step.bodyKey)}</Text>
          </View>

          <View style={styles.dotsRow} pointerEvents="auto">
            {HOME_TOUR_STEPS.map((s) => (
              <View
                key={s.id}
                style={[styles.dot, s.n === step.n ? styles.dotActive : null]}
              />
            ))}
          </View>

          {/* All three nav buttons stay mounted — no Back remount on step 1→2. */}
          <View style={styles.navRow} pointerEvents="auto" collapsable={false}>
            <TourPress
              armed={armed && !isFirst}
              onPress={goBack}
              label={t("home.tourBack")}
              style={styles.navBtn}
              textStyle={isFirst ? styles.navBackMuted : styles.navBack}
            >
              {t("home.tourBack")}
            </TourPress>
            <TourPress
              armed={armed}
              onPress={goSkip}
              label={t("home.tourSkip")}
              style={styles.navBtnCenter}
              textStyle={styles.navSkip}
            >
              {t("home.tourSkip")}
            </TourPress>
            <TourPress
              armed={armed}
              onPress={goNext}
              label={isLast ? t("home.tourDone") : t("home.tourNext")}
              style={styles.navBtnEnd}
              textStyle={styles.navNext}
            >
              {isLast ? t("home.tourDone") : t("home.tourNext")}
            </TourPress>
          </View>
        </View>
      </View>
    </View>
  );
}

export function HomeTourOverlay({ visible, onSkip, onDone }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.host} pointerEvents="box-none" collapsable={false}>
      {/* key resets local step when tour re-opens after a rare remount. */}
      <TourBody key="tour-body" onSkip={onSkip} onDone={onDone} />
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
    paddingVertical: 10,
    paddingRight: 8,
    minWidth: 72,
  },
  navBtnCenter: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    minWidth: 72,
    alignItems: "center",
  },
  navBtnEnd: {
    paddingVertical: 10,
    paddingLeft: 8,
    minWidth: 72,
    alignItems: "flex-end",
  },
  navBack: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
  },
  navBackMuted: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: "transparent",
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
