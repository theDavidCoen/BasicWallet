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
  useState,
  type ReactNode,
} from "react";
import { Dimensions, Keyboard, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { colors } from "../../theme/colors";
import {
  pickSnapOrDismiss,
  SHEET_SPRING,
  SNAP_OPEN,
  translateForVisibleFraction,
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
  /**
   * Visible height as a fraction of the window (0–1).
   * Default ~0.92 (Activity / Wallets). Pass 0.5 for compact Send sheets.
   */
  visibleFraction?: number;
  /**
   * Shrink sheet height to measured content (capped at visibleFraction).
   * Use for short confirm sheets (Exit Fiat Mode) to avoid a tall empty void.
   */
  fitContent?: boolean;
  /**
   * When true, lift the sheet above the system keyboard so content stays visible
   * (Send Enter). Caps at visibleFraction when the keyboard is hidden.
   */
  avoidKeyboard?: boolean;
  /** Host-owned shared values (Activity driven from Home). */
  motion?: SheetMotionShared;
  /**
   * Render in a transparent window Modal so ancestor padding (e.g. ScreenChrome)
   * cannot inset the sheet. Required for sheets opened from padded screens.
   * Leave false for SheetHost (shared motion / peek).
   */
  portal?: boolean;
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
      visibleFraction = SNAP_OPEN,
      fitContent = false,
      avoidKeyboard = false,
      motion: motionProp,
      portal = false,
    },
    ref,
  ) {
    const insets = useSafeAreaInsets();
    const windowHeight = Dimensions.get("window").height;
    const offscreenY = windowHeight;
    const clampedVisible = Math.max(0.2, Math.min(1, visibleFraction));
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const [contentH, setContentH] = useState(0);

    useEffect(() => {
      if (!open) setContentH(0);
    }, [open]);

    useEffect(() => {
      if (!avoidKeyboard || !open) {
        setKeyboardHeight(0);
        return;
      }
      const onShow = Keyboard.addListener(
        Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
        (e) => {
          setKeyboardHeight(Math.max(0, e.endCoordinates?.height ?? 0));
        },
      );
      const onHide = Keyboard.addListener(
        Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
        () => setKeyboardHeight(0),
      );
      return () => {
        onShow.remove();
        onHide.remove();
      };
    }, [avoidKeyboard, open]);

    // Edge-to-edge: system nav overlays the bottom of the window. Sheet height
    // must end at the screen bottom; paddingBottom clears the overlay. (Previously
    // we added bottomPad to height AND used the same value as padding, which left
    // content flush with the screen edge — under the nav bar.)
    const bottomPad = Math.max(
      insets.bottom,
      initialWindowMetrics?.insets.bottom ?? 0,
      Platform.OS === "android" ? 48 : 12,
    );
    const kb = avoidKeyboard && open ? keyboardHeight : 0;
    const maxVisibleH = windowHeight * clampedVisible;
    // Handle (~22) + top padding (~8) + bottomPad — keep content from clipping.
    const chromeExtra = 22 + 8 + bottomPad;

    let resolvedOpenY: number;
    let sheetHeight: number;
    let sheetPaddingBottom: number;
    if (kb > 0) {
      // Park the sheet directly above the keyboard; cap at visibleFraction.
      const spaceAboveKb = Math.max(180, windowHeight - kb - insets.top - 8);
      const visibleH = Math.min(maxVisibleH, spaceAboveKb);
      resolvedOpenY = Math.max(insets.top + 12, windowHeight - kb - visibleH);
      sheetHeight = visibleH;
      sheetPaddingBottom = 8;
    } else if (fitContent && contentH > 0) {
      const fitted = Math.min(maxVisibleH, contentH + chromeExtra);
      const minH = Math.max(180, fitted);
      sheetHeight = minH;
      resolvedOpenY = Math.max(insets.top + 12, windowHeight - minH);
      sheetPaddingBottom = bottomPad;
    } else {
      resolvedOpenY = Math.max(
        translateForVisibleFraction(windowHeight, clampedVisible),
        insets.top + 12,
      );
      sheetHeight = windowHeight - resolvedOpenY;
      sheetPaddingBottom = bottomPad;
    }

    const revealFallback =
      anchorY != null && anchorY > 0 && anchorY < windowHeight ? anchorY : offscreenY;

    const motion = useMotion(motionProp, offscreenY, resolvedOpenY);
    const { translateY, openY, revealY, offY, windowH, dragStartY } = motion;
    const wasOpen = useSharedValue(false);
    const openSV = useSharedValue(open ? 1 : 0);

    useEffect(() => {
      windowH.value = windowHeight;
      offY.value = offscreenY;
      openY.value = resolvedOpenY;
      revealY.value = revealFallback;
      openSV.value = open ? 1 : 0;
      if (!open) {
        cancelAnimation(translateY);
        translateY.value = offscreenY;
      } else if (wasOpen.value) {
        // Keyboard changed while open — re-snap to the lifted detent.
        cancelAnimation(translateY);
        translateY.value = withSpring(resolvedOpenY, SHEET_SPRING);
      }
    }, [
      offY,
      offscreenY,
      open,
      openSV,
      openY,
      resolvedOpenY,
      revealFallback,
      revealY,
      translateY,
      windowH,
      windowHeight,
      wasOpen,
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
            openY.value,
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
              openY.value,
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

    const sheetTree = (
      <View style={[StyleSheet.absoluteFill, styles.host]} pointerEvents="box-none">
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
              paddingBottom: sheetPaddingBottom,
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
          <View
            style={[styles.body, fitContent ? styles.bodyFit : null]}
            onLayout={
              fitContent
                ? (e) => {
                    const h = e.nativeEvent.layout.height;
                    if (h > 0 && Math.abs(h - contentH) > 1) setContentH(h);
                  }
                : undefined
            }
          >
            {children}
          </View>
        </Animated.View>
      </View>
    );

    if (portal) {
      // Modal is a new RN root — without SafeAreaProvider, insets are 0 and
      // the primary button sits under the Android nav bar.
      return (
        <Modal
          visible={open}
          transparent
          animationType="none"
          statusBarTranslucent
          onRequestClose={dismissAnimated}
        >
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <GestureHandlerRootView style={styles.portalRoot}>
              {sheetTree}
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </Modal>
      );
    }

    return sheetTree;
  },
);

const styles = StyleSheet.create({
  portalRoot: {
    flex: 1,
  },
  /** Above FundsNoticeOverlay (zIndex 100) so Save to contacts / Activity sheets win taps. */
  host: {
    zIndex: 200,
    elevation: 200,
  },
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
  /** fitContent must measure intrinsic height — flex:1 would report the sheet slot. */
  bodyFit: {
    flex: 0,
    flexGrow: 0,
  },
});
