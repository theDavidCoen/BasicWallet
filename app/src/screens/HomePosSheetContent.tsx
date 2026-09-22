/**
 * Home LTR side sheet — POS keypad → simplified receive (same as Receive overlay).
 */

import { useCallback, useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useWallet } from "../wallet/WalletProvider";
import { encodeReceiveBip21 } from "../wallet/bip21Receive";
import { colors } from "../theme/colors";
import { ReceivePosPanel } from "./ReceivePosPanel";

export function HomePosSheetContent({
  onClose,
  active,
}: {
  onClose: () => void;
  active: boolean;
}) {
  const {
    arkAddress,
    boardingAddress,
    boardingError,
    ensureBoardingAddress,
    selectedWallet,
  } = useWallet();

  const isLightning = selectedWallet?.kind === "lightning";

  useEffect(() => {
    if (isLightning) return;
    if (!selectedWallet || selectedWallet.kind !== "arkade") return;
    if (boardingAddress) return;
    void ensureBoardingAddress().catch(() => {
      /* boardingError set on provider */
    });
  }, [boardingAddress, ensureBoardingAddress, isLightning, selectedWallet]);

  const bip21Uri = useMemo(
    () => encodeReceiveBip21(boardingAddress, arkAddress, null),
    [boardingAddress, arkAddress],
  );

  const buildPosBip21 = useCallback(
    (amountSats: number) =>
      encodeReceiveBip21(boardingAddress, arkAddress, null, amountSats),
    [boardingAddress, arkAddress],
  );

  if (isLightning) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>POS is available on Arkade wallets.</Text>
      </View>
    );
  }

  // Show keypad immediately; Request stays disabled until BIP21 is ready.
  // Full-screen spinner previously delayed the first tappable frame.
  return (
    <View style={styles.fill}>
      {boardingError && !bip21Uri ? (
        <Text style={styles.banner}>{boardingError}</Text>
      ) : null}
      <ReceivePosPanel
        bip21Uri={bip21Uri}
        onClose={onClose}
        onRequestUri={buildPosBip21}
        active={active}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: colors.bg,
  },
  msg: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    marginTop: 12,
  },
  banner: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
  },
});
