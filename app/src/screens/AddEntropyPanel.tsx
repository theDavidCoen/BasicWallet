/**
 * Penpot 14b — ADD ENTROPY (finger draw / device tilt).
 * Motion mixes into CSPRNG later; this step only collects the motion digest.
 */

import { useEffect, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { Accelerometer } from "expo-sensors";
import {
  createMotionEntropyCollector,
  formatEntropyMeter,
  type MotionEntropyCollector,
} from "../onboarding/motionEntropy";
import { colors } from "../theme/colors";

type Props = {
  onComplete: (motionDigest32: Uint8Array) => void;
};

export function AddEntropyPanel({ onComplete }: Props) {
  const collectorRef = useRef<MotionEntropyCollector>(createMotionEntropyCollector());
  const [progress, setProgress] = useState(0);
  const [accelOn, setAccelOn] = useState(false);

  useEffect(() => {
    collectorRef.current.reset();
    setProgress(0);
    let sub: { remove: () => void } | null = null;
    let alive = true;
    void (async () => {
      try {
        Accelerometer.setUpdateInterval(50);
        sub = Accelerometer.addListener(({ x, y, z }) => {
          if (!alive) return;
          collectorRef.current.addAccelSample(x, y, z, Date.now());
          setProgress(collectorRef.current.progress());
        });
        setAccelOn(true);
      } catch {
        setAccelOn(false);
      }
    })();
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        collectorRef.current.addTouchSample(locationX, locationY, Date.now());
        setProgress(collectorRef.current.progress());
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        collectorRef.current.addTouchSample(locationX, locationY, Date.now());
        setProgress(collectorRef.current.progress());
      },
    }),
  ).current;

  const ready = progress >= 1;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>ADD ENTROPY</Text>
      <Text style={styles.caption}>
        Move your finger or tilt the device{"\n"}
        to mix entropy into a new wallet seed.
      </Text>
      <Text style={styles.hint}>
        Device CSPRNG always anchors the seed; motion only strengthens it.
        {accelOn ? "" : "\n(Tilt unavailable — draw on the pad.)"}
      </Text>

      <View style={styles.pad} {...pan.panHandlers}>
        <Text style={styles.padLabel}>Draw here</Text>
      </View>

      <Text style={styles.meter}>{formatEntropyMeter(progress)}</Text>

      <Pressable
        style={[styles.primary, !ready && { opacity: 0.4 }]}
        disabled={!ready}
        onPress={() => onComplete(collectorRef.current.digest())}
      >
        <Text style={styles.primaryText}>Continue to name wallet</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 4,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 12,
    lineHeight: 16,
  },
  pad: {
    flex: 1,
    minHeight: 200,
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 16,
    backgroundColor: "#0D0D0D",
    alignItems: "center",
    justifyContent: "center",
  },
  padLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
  },
  meter: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  primary: {
    borderRadius: 10,
    backgroundColor: colors.fg,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.bg,
  },
});
