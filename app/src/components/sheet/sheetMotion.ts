/**
 * Shared motion for InteractiveBottomSheet.
 * Single open detent (~92%); drag 1:1 on UI thread; spring snap/dismiss.
 */

import { Easing, type WithSpringConfig } from "react-native-reanimated";

/** Visible fraction at the open detent (top margin for grabber / dismiss). */
export const SNAP_OPEN = 0.92;

/** Fallback timed snap (rarely used). */
export const SHEET_SNAP_DURATION_MS = 220;
export const SHEET_SNAP_EASING = Easing.bezier(0.22, 1, 0.36, 1);

/** Spring for open / dismiss — snappy but not harsh. */
export const SHEET_SPRING: WithSpringConfig = {
  damping: 26,
  stiffness: 320,
  mass: 0.85,
  overshootClamping: true,
};

/** Velocity (px/s) that biases snap choice on release. */
export const SHEET_FLING_UP_VY = -600;
export const SHEET_FLING_DOWN_VY = 600;

/** Horizontal fling thresholds (Settings / Scan side pages). */
export const SHEET_FLING_OPEN_VX = 600;
export const SHEET_FLING_CLOSE_VX = 600;

export type SheetSnapIndex = 0;

/** Side page enters from left (Settings) or right (Scan). */
export type SideSheetSide = "left" | "right";

export function translateForVisibleFraction(windowHeight: number, visible: number): number {
  "worklet";
  const v = Math.max(0, Math.min(1, visible));
  return windowHeight * (1 - v);
}

export function snapTranslate(windowHeight: number, _index: SheetSnapIndex = 0): number {
  "worklet";
  return translateForVisibleFraction(windowHeight, SNAP_OPEN);
}

/**
 * Pick open (0) or dismiss (-1) from release position + velocity.
 * `closedY` = dismiss threshold (Home handle Y).
 */
export function pickSnapOrDismiss(
  windowHeight: number,
  closedY: number,
  translateY: number,
  velocityY: number,
): SheetSnapIndex | -1 {
  "worklet";
  const openY = snapTranslate(windowHeight, 0);
  const midDismiss = (openY + closedY) / 2;

  if (velocityY <= SHEET_FLING_UP_VY) return 0;
  if (velocityY >= SHEET_FLING_DOWN_VY) return -1;
  if (translateY >= midDismiss) return -1;
  return 0;
}

/** Off-screen X for a full-width side page. */
export function sideOffX(windowWidth: number, side: SideSheetSide): number {
  "worklet";
  return side === "left" ? -windowWidth : windowWidth;
}

/**
 * Pick open (0) or dismiss (-1) for a horizontal side page.
 * openX = 0; offX = ±windowWidth.
 */
export function pickSnapOrDismissX(
  windowWidth: number,
  translateX: number,
  velocityX: number,
  side: SideSheetSide,
): SheetSnapIndex | -1 {
  "worklet";
  const off = sideOffX(windowWidth, side);
  const mid = off / 2;

  if (side === "left") {
    // Swipe right opens; swipe left dismisses.
    if (velocityX >= SHEET_FLING_OPEN_VX) return 0;
    if (velocityX <= -SHEET_FLING_CLOSE_VX) return -1;
    if (translateX <= mid) return -1;
    return 0;
  }

  // Right: swipe left opens; swipe right dismisses.
  if (velocityX <= -SHEET_FLING_OPEN_VX) return 0;
  if (velocityX >= SHEET_FLING_CLOSE_VX) return -1;
  if (translateX >= mid) return -1;
  return 0;
}
