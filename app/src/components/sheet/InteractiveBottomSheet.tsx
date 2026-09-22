/**
 * Interactive bottom sheet — UI-thread pan + spring snap.
 * Shared values may be owned by SheetHost so Home can drive the same motion
 * without crossing the JS bridge every frame.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  type ReactNode,
} from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme/colors";
import {
  pickSnapOrDismiss,
  SHEET_SPRING,
  snapTranslate,
  type SheetSnapIndex,
} from "./sheetMotion";

export type SheetMotionShared = {
  translateY: SharedValue<number>;
  openY: SharedValue<number>;
  revealY: SharedValue<number>;
  offY: SharedValue<number>;
  windowH: SharedValue<number>;
  dragStartY: SharedValue<number>;
};

export type InteractiveBottomSheetRef = {
  snapTo: (index?: SheetSnapIndex) => void;
  expand: () => void;
  dismiss: () => void;
  setTranslateFromGesture: (translateY: number) => void;
  endExternalGesture: (velocityY: number) => void;
  getClosedTranslate: () => number;
  getAnchorTranslate: () => number;
  getSnapTranslate: (index?: SheetSnapIndex) => number;
  motion: SheetMotionShared;
};

type Props = {
  open: boolean;
  onDismiss: () => void;
  onSnapChange?: (index: SheetSnapIndex) => void;
  children: ReactNode;
  skipEnterSnap?: boolean;
  anchorY?: number | null;
  /** Host-owned shared values (Activity driven from Home). */
  motion?: SheetMotionShared;
};

function useMotion(
  external: SheetMotionShared | undefined,
  offscreenY: number,
  openYInit: number,
): SheetMotionShared {
  const translateYLocal = useSharedValue(offscreenY);
  const openYLocal = useSharedValue(openYInit);
  const revealYLocal = useSharedValue(offscreenY);
  const offYLocal = useSharedValue(offscreenY);
  const windowHLocal = useSharedValue(offscreenY);
  const dragStartYLocal = useSharedValue(offscreenY);

  return (
    external ?? {
      translateY: translateYLocal,
      openY: openYLocal,
      revealY: revealYLocal,
      offY: offYLocal,
      windowH: windowHLocal,
      dragStartY: dragStartYLocal,
    }
  );
}

export const InteractiveBottomSheet = forwardRef<InteractiveBottomSheetRef, Props>(
  function InteractiveBottomSheet(
    {
      open,
      onDismiss,
      onSnapChange,
      children,
      skipEnterSnap = false,
      anchorY = null,
      motion: motionProp,
    },
    ref,
  ) {
    const insets = useSafeAreaInsets();
    const windowHeight = Dimensions.get("window").height;
    const offscreenY = windowHeight;
    const computedOpenY = Math.max(snapTranslate(windowHeight, 0), insets.top + 12);
    const revealFallback =
      anchorY != null && anchorY > 0 && anchorY < windowHeight ? anchorY : offscreenY;

    const motion = useMotion(motionProp, offscreenY, computedOpenY);
    const { translateY, openY, revealY, offY, windowH, dragStartY } = motion;
    const wasOpen = useSharedValue(false);
    const openSV = useSharedValue(open ? 1 : 0);

    useEffect(() => {
      windowH.value = windowHeight;
      offY.value = offscreenY;
      openY.value = computedOpenY;
      revealY.value = revealFallback;
      openSV.value = open ? 1 : 0;
      if (!open) {
        cancelAnimation(translateY);
        translateY.value = offscreenY;
      }
    }, [
      computedOpenY,
      offY,
      offscreenY,
      open,
      openSV,
      openY,
      revealFallback,
      revealY,
      translateY,
      windowH,
      windowHeight,
    ]);

    const notifySnap = useCallback(
      (index: SheetSnapIndex) => {
        onSnapChange?.(index);
      },
      [onSnapChange],
    );

    const finishDismiss = useCallback(() => {
      onDismiss();
    }, [onDismiss]);

    const springTo = useCallback(
      (to: number, onDone?: () => void) => {
        cancelAnimation(translateY);
        translateY.value = withSpring(to, SHEET_SPRING, (finished) => {
          if (finished && onDone) runOnJS(onDone)();
        });
      },
      [translateY],
    );

    const snapOpen = useCallback(() => {
      springTo(openY.value);
      notifySnap(0);
    }, [notifySnap, openY, springTo]);

    const dismissAnimated = useCallback(() => {
      springTo(offY.value, finishDismiss);
    }, [finishDismiss, offY, springTo]);

    useEffect(() => {
      if (open) {
        if (!wasOpen.value) {
          wasOpen.value = true;
          if (!skipEnterSnap) {
            cancelAnimation(translateY);
            translateY.value = revealY.value;
            translateY.value = withSpring(openY.value, SHEET_SPRING);
            notifySnap(0);
          }
        }
      } else if (wasOpen.value) {
        wasOpen.value = false;
        cancelAnimation(translateY);
        translateY.value = withSpring(offY.value, SHEET_SPRING);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, skipEnterSnap]);

    useImperativeHandle(
      ref,
      () => ({
        snapTo: () => snapOpen(),
        expand: () => snapOpen(),
        dismiss: dismissAnimated,
        setTranslateFromGesture: (y: number) => {
          cancelAnimation(translateY);
          translateY.value = Math.max(openY.value, Math.min(offY.value, y));
        },
        endExternalGesture: (velocityY: number) => {
          const decision = pickSnapOrDismiss(
            windowH.value,
            revealY.value,
            translateY.value,
            velocityY,
          );
          if (decision === -1) {
            dismissAnimated();
            return;
          }
          snapOpen();
        },
        getClosedTranslate: () => revealY.value,
        getAnchorTranslate: () => revealY.value,
        getSnapTranslate: () => openY.value,
        motion,
      }),
      [
        dismissAnimated,
        motion,
        offY,
        openY,
        revealY,
        snapOpen,
        translateY,
        windowH,
      ],
    );

    const pan = useMemo(
      () =>
        Gesture.Pan()
          .activeOffsetY([-4, 4])
          .failOffsetX([-40, 40])
          .onBegin(() => {
            "worklet";
            cancelAnimation(translateY);
            dragStartY.value = translateY.value;
          })
          .onUpdate((e) => {
            "worklet";
            const next = dragStartY.value + e.translationY;
            translateY.value = Math.max(openY.value, Math.min(offY.value, next));
          })
          .onEnd((e) => {
            "worklet";
            const decision = pickSnapOrDismiss(
              windowH.value,
              revealY.value,
              translateY.value,
              e.velocityY,
            );
            if (decision === -1) {
              translateY.value = withSpring(offY.value, SHEET_SPRING, (finished) => {
                if (finished) runOnJS(finishDismiss)();
              });
              return;
            }
            translateY.value = withSpring(openY.value, SHEET_SPRING);
            runOnJS(notifySnap)(0);
          }),
      [
        dragStartY,
        finishDismiss,
        notifySnap,
        offY,
        openY,
        revealY,
        translateY,
        windowH,
      ],
    );

    const sheetStyle = useAnimatedStyle(() => ({
      transform: [{ translateY: translateY.value }],
    }));

    const scrimStyle = useAnimatedStyle(() => {
      if (openSV.value < 0.5) return { opacity: 0 };
      // Off-screen → no dim (avoids stuck / mis-init openY making Home look dark).
      if (translateY.value >= offY.value - 1) {
        return { opacity: 0 };
      }
      const span = Math.max(1, offY.value - openY.value);
      const progress = (offY.value - translateY.value) / span;
      return { opacity: Math.max(0, Math.min(1, progress)) * 0.4 };
    });

    const sheetHeight = windowHeight - computedOpenY + Math.max(insets.bottom, 12);

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {open ? (
          <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents="auto">
            <Pressable style={StyleSheet.absoluteFill} onPress={dismissAnimated} />
          </Animated.View>
        ) : null}

        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              paddingBottom: Math.max(insets.bottom, 12),
            },
            sheetStyle,
          ]}
          pointerEvents={open ? "auto" : "none"}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.grabberHit}>
              <View style={styles.grabber} />
            </View>
          </GestureDetector>
          <View style={styles.body}>{children}</View>
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#000",
  },
  scrimClosed: {
    opacity: 0,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.fg,
    overflow: "hidden",
  },
  grabberHit: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 16,
    minHeight: 44,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.border,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
});
