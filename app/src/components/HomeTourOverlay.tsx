/**
 * Spotlight D Home onboarding tour overlay.
 *
 * Architecture (rc.23):
 * - UX frozen: in-card Back/Next, Skip under, chrome hints, no card swipe.
 * - Unified long high-contrast arrows for swipe + tap targets (no circle pulses).
 * - Soft nudge on active step only (one withRepeat).
 * - Home poll setState paused while tour open; host pointerEvents=auto.
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { HOME_TOUR_STEPS } from "../home/homeTour";
import { logTourTap } from "../home/homeTourPerf";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";

const CARD_WIDTH = 300;
const STEP_COUNT = HOME_TOUR_STEPS.length;
const CLUSTER_TOP_FRAC = 0.52;
const TOUR_ARM_MS = 480;
const DIM_TAP_SLOP_PX = 12;
/** Home BasicLogo scale=1 → ink height (BasicLogo VIEW_H * 0.55). */
const HOME_LOGO_H = Math.round(62 * 0.55);
/** ScreenChrome header minHeight. */
const HEADER_ROW_H = 48;
/** Unified tour arrow — longer + high-contrast white. */
const ARROW_W = 64;
const ARROW_H = 32;
const ARROW_STROKE = "rgba(255,255,255,0.92)";
/** Shaft + head in viewBox 0 0 48 24 (points right; rotate for other dirs). */
const ARROW_PATH = "M2 12 H34 M26 4 L42 12 L26 20";

type HintKind = (typeof HOME_TOUR_STEPS)[number]["hint"];
type ArrowDir = "left" | "right" | "up" | "down";

type Props = {
  visible: boolean;
  onSkip: () => void;
  onDone: () => void;
};

function ArrowGlyph({ pointing }: { pointing: ArrowDir }) {
  const rotate =
    pointing === "right"
      ? "0deg"
      : pointing === "left"
        ? "180deg"
        : pointing === "up"
          ? "-90deg"
          : "90deg";
  return (
    <View style={{ transform: [{ rotate }] }}>
      <Svg width={ARROW_W} height={ARROW_H} viewBox="0 0 48 24">
        <Path
          d={ARROW_PATH}
          fill="none"
          stroke={ARROW_STROKE}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/** Soft nudge along the arrow axis (swipe or tap). One withRepeat when mounted. */
function SoftArrowHint({ pointing }: { pointing: ArrowDir }) {
  const axis = pointing === "left" || pointing === "right" ? "x" : "y";
  const sign =
    pointing === "right" || pointing === "down" ? 1 : -1;
  const from = -14 * sign;
  const to = 14 * sign;
  const tx = useSharedValue(axis === "x" ? from : 0);
  const ty = useSharedValue(axis === "y" ? from : 0);
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    if (axis === "x") {
      tx.value = from;
      tx.value = withRepeat(
        withSequence(
          withTiming(to, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
          withTiming(from, { duration: 0 }),
        ),
        -1,
        false,
      );
    } else {
      ty.value = from;
      ty.value = withRepeat(
        withSequence(
          withTiming(to, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(from, { duration: 0 }),
        ),
        -1,
        false,
      );
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 500 }),
        withTiming(0.5, { duration: 500 }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(opacity);
    };
  }, [axis, from, opacity, to, tx, ty]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.hintAnim, style]} pointerEvents="none">
      <ArrowGlyph pointing={pointing} />
    </Animated.View>
  );
}

/**
 * Only the active hint mounts Soft* (one withRepeat). Inactive = unmounted.
 * Re-renders on step change via `activeHint`; Home ticks do not reach here
 * (TourBody memo + stable callbacks).
 */
const TourHintsLayer = memo(function TourHintsLayer({
  activeHint,
  insetsTop,
}: {
  activeHint: HintKind;
  insetsTop: number;
}) {
  const headerY = Math.max(insetsTop, 12) + 8;
  /**
   * Add Wallet / Fiat: arrow sits above the header circles and points down.
   */
  const cornerArrowTop = Math.max(insetsTop, headerY - ARROW_H - 4);
  /**
   * Settings: under the Basic wordmark, centered — arrow points up at the logo.
   */
  const logoTop = headerY + (HEADER_ROW_H - HOME_LOGO_H) / 2;
  const settingsArrowTop = logoTop + HOME_LOGO_H + 10;
  const swipeTop = headerY + 96;

  return (
    <>
      {activeHint === "swipe_ltr" ? (
        <View style={[styles.swipeBand, { top: swipeTop }]} pointerEvents="none">
          <SoftArrowHint pointing="right" />
        </View>
      ) : null}
      {activeHint === "swipe_rtl" ? (
        <View style={[styles.swipeBand, { top: swipeTop }]} pointerEvents="none">
          <SoftArrowHint pointing="left" />
        </View>
      ) : null}
      {activeHint === "pulse_settings" ? (
        <View
          style={[styles.pulseCenterRow, { top: settingsArrowTop }]}
          pointerEvents="none"
        >
          <SoftArrowHint pointing="up" />
        </View>
      ) : null}
      {activeHint === "pulse_avatar" ? (
        <View
          style={[styles.cornerArrow, { top: cornerArrowTop, left: 8 }]}
          pointerEvents="none"
        >
          <SoftArrowHint pointing="down" />
        </View>
      ) : null}
      {activeHint === "pulse_fiat" ? (
        <View
          style={[styles.cornerArrow, { top: cornerArrowTop, right: 8 }]}
          pointerEvents="none"
        >
          <SoftArrowHint pointing="down" />
        </View>
      ) : null}
    </>
  );
});

/** Same hit pattern as Home Receive/Send (`onPressIn`). */
function TourHit({
  onPress,
  armed,
  label,
  style,
  textStyle,
  children,
  probeDir,
}: {
  onPress: () => void;
  armed: boolean;
  label: string;
  style?: object;
  textStyle: object | Array<object | null | false | undefined>;
  children: string;
  probeDir: string;
}) {
  return (
    <Pressable
      onPressIn={() => {
        const t0 = Date.now();
        logTourTap("touch", probeDir, t0);
        if (!armed) return;
        onPress();
      }}
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
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;
  const armedRef = useRef(armed);
  armedRef.current = armed;

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
        const ok = armedRef.current && start.current != null && !moved.current;
        start.current = null;
        if (ok) onSkipRef.current();
      }}
      onTouchCancel={() => {
        start.current = null;
        moved.current = true;
      }}
    />
  );
}

type TapProbe = { dir: "back" | "next" | "skip"; t0: number };

/**
 * Owns step state. Default-memoized; parent passes stable onSkip/onDone.
 * Do not use arePropsEqual→true — that broke hit delivery on rc.19.
 */
const TourBody = memo(function TourBody({
  onSkip,
  onDone,
}: {
  onSkip: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  /** Dim/outside only — nav buttons work immediately (rc.19 arm gated all hits). */
  const [dimArmed, setDimArmed] = useState(false);
  const stepRef = useRef(0);
  const tapProbe = useRef<TapProbe | null>(null);
  const onSkipRef = useRef(onSkip);
  const onDoneRef = useRef(onDone);
  onSkipRef.current = onSkip;
  onDoneRef.current = onDone;

  useEffect(() => {
    setDimArmed(false);
    const id = setTimeout(() => setDimArmed(true), TOUR_ARM_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    console.log("[HomeTour] body mounted");
  }, []);

  const step =
    HOME_TOUR_STEPS[Math.max(0, Math.min(stepIndex, STEP_COUNT - 1))]!;
  const isFirst = step.n <= 1;
  const isLast = step.n >= STEP_COUNT;

  useLayoutEffect(() => {
    const probe = tapProbe.current;
    if (!probe) return;
    logTourTap("commit", probe.dir, probe.t0, `step=${stepIndex}`);
    const t0 = probe.t0;
    const dir = probe.dir;
    tapProbe.current = null;
    requestAnimationFrame(() => {
      logTourTap("raf1", dir, t0);
      requestAnimationFrame(() => logTourTap("raf2", dir, t0));
    });
  }, [stepIndex]);

  const clusterTop = useMemo(() => {
    const windowH = Dimensions.get("window").height;
    return Math.round(windowH * CLUSTER_TOP_FRAC);
  }, []);

  const applyStep = useCallback((next: number, dir: "back" | "next", t0: number) => {
    logTourTap("setState", dir, t0);
    const clamped = Math.max(0, Math.min(STEP_COUNT - 1, next));
    stepRef.current = clamped;
    tapProbe.current = { dir, t0 };
    setStepIndex(clamped);
  }, []);

  const goNext = useCallback(() => {
    const t0 = Date.now();
    logTourTap("handler", "next", t0);
    const prev = stepRef.current;
    if (prev >= STEP_COUNT - 1) {
      queueMicrotask(() => onDoneRef.current());
      return;
    }
    applyStep(prev + 1, "next", t0);
  }, [applyStep]);

  const goBack = useCallback(() => {
    const t0 = Date.now();
    logTourTap("handler", "back", t0);
    const prev = stepRef.current;
    if (prev <= 0) return;
    applyStep(prev - 1, "back", t0);
  }, [applyStep]);

  const goSkip = useCallback(() => {
    const t0 = Date.now();
    logTourTap("handler", "skip", t0);
    tapProbe.current = { dir: "skip", t0 };
    queueMicrotask(() => onSkipRef.current());
  }, []);

  const backLabel = t("home.tourBack");
  const skipLabel = t("home.tourSkip");
  const nextLabel = isLast ? t("home.tourDone") : t("home.tourNext");

  return (
    <View style={styles.portalRoot} pointerEvents="box-none">
      <DimTapSkip armed={dimArmed} onSkip={goSkip} label={skipLabel} />

      <TourHintsLayer activeHint={step.hint} insetsTop={insets.top} />

      <View style={styles.stage} pointerEvents="box-none">
        <View
          style={[styles.cluster, { top: clusterTop }]}
          collapsable={false}
          pointerEvents="box-none"
        >
          <View style={styles.card} pointerEvents="auto" collapsable={false}>
            <Text style={styles.stepNum} pointerEvents="none">
              {step.n}
            </Text>
            <Text style={styles.title} pointerEvents="none">
              {t(step.titleKey)}
            </Text>
            <Text style={styles.body} pointerEvents="none">
              {t(step.bodyKey)}
            </Text>

            <View style={styles.cardFooter} collapsable={false}>
              <TourHit
                armed
                probeDir="back"
                onPress={goBack}
                label={backLabel}
                style={styles.cardNavBtn}
                textStyle={[styles.navBack, isFirst && styles.navBackMuted]}
              >
                {backLabel}
              </TourHit>
              <TourHit
                armed
                probeDir="next"
                onPress={goNext}
                label={nextLabel}
                style={styles.cardNavBtnEnd}
                textStyle={styles.navNext}
              >
                {nextLabel}
              </TourHit>
            </View>
          </View>

          <View style={styles.dotsRow} pointerEvents="none">
            {HOME_TOUR_STEPS.map((s) => (
              <View
                key={s.id}
                style={[styles.dot, s.n === step.n ? styles.dotActive : null]}
              />
            ))}
          </View>

          <View
            style={styles.skipRow}
            pointerEvents="box-none"
            collapsable={false}
          >
            <TourHit
              armed
              probeDir="skip"
              onPress={goSkip}
              label={skipLabel}
              style={styles.skipHit}
              textStyle={styles.navSkip}
            >
              {skipLabel}
            </TourHit>
          </View>
        </View>
      </View>
    </View>
  );
});

export const HomeTourOverlay = memo(function HomeTourOverlay({
  visible,
  onSkip,
  onDone,
}: Props) {
  const skipRef = useRef(onSkip);
  const doneRef = useRef(onDone);
  skipRef.current = onSkip;
  doneRef.current = onDone;
  const onSkipStable = useCallback(() => {
    skipRef.current();
  }, []);
  const onDoneStable = useCallback(() => {
    doneRef.current();
  }, []);

  if (!visible) return null;
  return (
    <View style={styles.host} pointerEvents="auto" collapsable={false}>
      <TourBody onSkip={onSkipStable} onDone={onDoneStable} />
    </View>
  );
});

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
    paddingBottom: 12,
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
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "stretch",
    marginTop: 16,
    paddingTop: 4,
  },
  cardNavBtn: {
    flex: 1,
    paddingVertical: 18,
    paddingRight: 12,
    minHeight: 52,
    justifyContent: "center",
  },
  cardNavBtnEnd: {
    flex: 1,
    paddingVertical: 18,
    paddingLeft: 12,
    minHeight: 52,
    alignItems: "flex-end",
    justifyContent: "center",
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
  skipRow: {
    width: CARD_WIDTH,
    maxWidth: "100%",
    alignItems: "center",
    marginTop: 4,
  },
  skipHit: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    minWidth: 72,
    alignItems: "center",
  },
  navBack: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
  },
  navBackMuted: {
    opacity: 0,
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
    height: ARROW_H + 16,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  hintAnim: {
    alignItems: "center",
    justifyContent: "center",
  },
  pulseCenterRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: ARROW_H + 12,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  cornerArrow: {
    position: "absolute",
    width: ARROW_W + 8,
    height: ARROW_H + 12,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
});
