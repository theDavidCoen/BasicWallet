/**
 * Interactive full-page side sheet — UI-thread pan + spring snap.
 * Mirrors InteractiveBottomSheet for horizontal POS / Scan.
 * Shared values may be owned by SheetHost so Home can drive motion 1:1.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  type ReactNode,
} from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { colors } from "../../theme/colors";
import {
  pickSnapOrDismissX,
  SHEET_SPRING,
  sideOffX,
  type SheetSnapIndex,
  type SideSheetSide,
} from "./sheetMotion";

export type SideMotionShared = {
  translateX: SharedValue<number>;
  openX: SharedValue<number>;
  offX: SharedValue<number>;
  windowW: SharedValue<number>;
  dragStartX: SharedValue<number>;
};

export type InteractiveSideSheetRef = {
  snapTo: (index?: SheetSnapIndex) => void;
  expand: () => void;
  dismiss: () => void;
  motion: SideMotionShared;
};

type Props = {
  open: boolean;
  side: SideSheetSide;
  onDismiss: () => void;
  children: ReactNode;
  /** Home already placed the sheet under the finger — skip enter spring. */
  skipEnterSnap?: boolean;
  motion?: SideMotionShared;
};

function useMotion(
  external: SideMotionShared | undefined,
  offscreenX: number,
): SideMotionShared {
  const translateXLocal = useSharedValue(offscreenX);
  const openXLocal = useSharedValue(0);
  const offXLocal = useSharedValue(offscreenX);
  const windowWLocal = useSharedValue(Math.abs(offscreenX) || 1);
  const dragStartXLocal = useSharedValue(offscreenX);

  return (
    external ?? {
      translateX: translateXLocal,
      openX: openXLocal,
      offX: offXLocal,
      windowW: windowWLocal,
      dragStartX: dragStartXLocal,
    }
  );
}

export const InteractiveSideSheet = forwardRef<InteractiveSideSheetRef, Props>(
  function InteractiveSideSheet(
    { open, side, onDismiss, children, skipEnterSnap = false, motion: motionProp },
    ref,
  ) {
    const windowWidth = Dimensions.get("window").width;
    const offscreenX = sideOffX(windowWidth, side);
    const motion = useMotion(motionProp, offscreenX);
    const { translateX, openX, offX, windowW, dragStartX } = motion;
    const wasOpen = useSharedValue(false);
    /** Drives scrim opacity; must drop to 0 the instant `open` becomes false
     *  (animated translateX can lag one frame and leave a dim layer on Home). */
    const openSV = useSharedValue(open ? 1 : 0);

    useEffect(() => {
      windowW.value = windowWidth;
      offX.value = offscreenX;
      openX.value = 0;
      openSV.value = open ? 1 : 0;
      if (!open) {
        cancelAnimation(translateX);
        translateX.value = offscreenX;
      }
    }, [offX, offscreenX, open, openSV, openX, translateX, windowW, windowWidth]);

    const finishDismiss = useCallback(() => {
      onDismiss();
    }, [onDismiss]);

    const springTo = useCallback(
      (to: number, onDone?: () => void) => {
        cancelAnimation(translateX);
        translateX.value = withSpring(to, SHEET_SPRING, (finished) => {
          if (finished && onDone) runOnJS(onDone)();
        });
      },
      [translateX],
    );

    const snapOpen = useCallback(() => {
      springTo(openX.value);
    }, [openX, springTo]);

    const dismissAnimated = useCallback(() => {
      springTo(offX.value, finishDismiss);
    }, [finishDismiss, offX, springTo]);

    useEffect(() => {
      if (open) {
        if (!wasOpen.value) {
          wasOpen.value = true;
          if (!skipEnterSnap) {
            cancelAnimation(translateX);
            translateX.value = offX.value;
            translateX.value = withSpring(openX.value, SHEET_SPRING);
          }
        }
      } else if (wasOpen.value) {
        wasOpen.value = false;
        cancelAnimation(translateX);
        if (Math.abs(translateX.value - offX.value) < 2) {
          translateX.value = offX.value;
        } else {
          translateX.value = withSpring(offX.value, SHEET_SPRING);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, skipEnterSnap]);

    useImperativeHandle(
      ref,
      () => ({
        snapTo: () => snapOpen(),
        expand: () => snapOpen(),
        dismiss: dismissAnimated,
        motion,
      }),
      [dismissAnimated, motion, snapOpen],
    );

    const pan = useMemo(
      () =>
        Gesture.Pan()
          // Edge-only dismiss; keep thresholds loose so short taps never start a pan.
          .activeOffsetX([-20, 20])
          .failOffsetY([-24, 24])
          .onBegin(() => {
            "worklet";
            cancelAnimation(translateX);
            dragStartX.value = translateX.value;
          })
          .onUpdate((e) => {
            "worklet";
            const next = dragStartX.value + e.translationX;
            if (side === "left") {
              translateX.value = Math.max(offX.value, Math.min(openX.value, next));
            } else {
              translateX.value = Math.min(offX.value, Math.max(openX.value, next));
            }
          })
          .onEnd((e) => {
            "worklet";
            const decision = pickSnapOrDismissX(
              windowW.value,
              translateX.value,
              e.velocityX,
              side,
            );
            if (decision === -1) {
              translateX.value = withSpring(offX.value, SHEET_SPRING, (finished) => {
                if (finished) runOnJS(finishDismiss)();
              });
              return;
            }
            translateX.value = withSpring(openX.value, SHEET_SPRING);
          }),
      [dragStartX, finishDismiss, offX, openX, side, translateX, windowW],
    );

    const sheetStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: translateX.value }],
    }));

    const scrimStyle = useAnimatedStyle(() => {
      if (openSV.value < 0.5) return { opacity: 0 };
      const off = offX.value;
      const span = Math.max(1, Math.abs(off - openX.value));
      const progress = Math.abs(off - translateX.value) / span;
      if (progress < 0.01) return { opacity: 0 };
      return { opacity: Math.max(0, Math.min(1, progress)) * 0.4 };
    });

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Visual dim only — never capture taps. Full-screen side sheets cover the
            scrim when open; a Pressable here was eating keypad taps and dismissing. */}
        {open ? (
          <Animated.View
            style={[styles.scrim, scrimStyle]}
            pointerEvents="none"
          />
        ) : null}

        <Animated.View
          style={[styles.sheet, sheetStyle]}
          pointerEvents={open ? "auto" : "none"}
        >
          <GestureDetector gesture={pan}>
            <View
              style={[
                styles.edgeHit,
                side === "left" ? styles.edgeHitRight : styles.edgeHitLeft,
              ]}
            >
              <View style={styles.edgeGrabber} />
            </View>
          </GestureDetector>
          <View style={styles.body} collapsable={false}>
            {children}
          </View>
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#000",
    zIndex: 0,
  },
  sheet: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    overflow: "hidden",
    zIndex: 1,
    elevation: 8,
  },
  edgeHit: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 28,
    zIndex: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  edgeHitLeft: { left: 0 },
  edgeHitRight: { right: 0 },
  edgeGrabber: {
    width: 5,
    height: 40,
    borderRadius: 2.5,
    backgroundColor: colors.border,
  },
  body: {
    flex: 1,
  },
});
