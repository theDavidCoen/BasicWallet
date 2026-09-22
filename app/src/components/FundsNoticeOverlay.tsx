/**
 * Full-screen send/receive notice (not a modal or bottom sheet).
 * Dismiss via Done / View activity / hardware back only — no auto-home
 * (the old 3s timer reset on every balance poll and raced the Done button).
 */

import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

export function FundsNoticeOverlay({
  open,
  children,
}: {
  open: boolean;
  /** @deprecated Auto-home removed; kept optional so call sites need not change. */
  onAutoHome?: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  if (!open) return null;

  return (
    <View
      style={[
        styles.fill,
        {
          paddingTop: Math.max(insets.top, 12) + 8,
          paddingBottom: insets.bottom + 16,
        },
      ]}
      pointerEvents="auto"
      collapsable={false}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    zIndex: 100,
    elevation: 100,
  },
});
