import { BlurView } from "expo-blur";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

type Props = {
  value: string;
  /** Inline QR size (default 220). */
  size?: number;
  ecl?: "L" | "M" | "Q" | "H";
};

const PAD = 28;

/**
 * Tap the QR to expand it fullscreen (square, aspect preserved) over a blurred backdrop.
 * Tap anywhere (or system back) to dismiss.
 */
export function ExpandableQrCode({ value, size = 220, ecl = "M" }: Props) {
  const [open, setOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const expandedSize = useMemo(() => {
    const usableW = width - PAD * 2 - insets.left - insets.right;
    const usableH = height - PAD * 2 - insets.top - insets.bottom;
    return Math.max(160, Math.floor(Math.min(usableW, usableH)));
  }, [width, height, insets.left, insets.right, insets.top, insets.bottom]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Expand QR code"
        onPress={() => setOpen(true)}
        style={styles.inlineWrap}
      >
        <QRCode
          value={value}
          size={size}
          backgroundColor="#FFFFFF"
          color="#000000"
          ecl={ecl}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close expanded QR"
          onPress={() => setOpen(false)}
        >
          <BlurView
            intensity={60}
            tint="dark"
            blurMethod="dimezisBlurViewSdk31Plus"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.dim} pointerEvents="none" />
          <View
            style={[styles.expandedWrap, { width: expandedSize, height: expandedSize }]}
            pointerEvents="none"
          >
            <QRCode
              value={value}
              size={expandedSize - 24}
              backgroundColor="#FFFFFF"
              color="#000000"
              ecl={ecl}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  inlineWrap: {
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 4,
  },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  expandedWrap: {
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
