/**
 * Home dialog: incoming contact share via Nostr.
 * Tap body → offer screen. X → dismiss forever for that offer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
import {
  dismissContactShareOffer,
  listPendingContactShares,
  subscribeContactShareInbox,
  type ContactShareOffer,
} from "../contacts/contactShareInbox";
import {
  queueContactShareWatchBoot,
  stopContactShareWatch,
} from "../contacts/contactShareWatch";
import { contactDisplayName, midEllipsis } from "../contacts/types";
import { unregisterPushBestEffort } from "../notifications/register";
import { useHomeTourUiOpen } from "../home/useHomeTourUiOpen";
import { useWallet } from "../wallet/WalletProvider";
import { useSheets } from "./SheetHost";
import { Hint } from "../components/ui";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { radii } from "../theme/radii";

export function ContactShareReminder({
  navigationRef,
}: {
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
}) {
  const insets = useSafeAreaInsets();
  const { hasWallet } = useWallet();
  const {
    activityOpen,
    walletOpen,
    fundsReceivedOpen,
    fundsSentOpen,
    posOpen,
    scanOpen,
    fiatModeSheetOpen,
  } = useSheets();
  const [offer, setOffer] = useState<ContactShareOffer | null>(null);
  const [routeName, setRouteName] = useState<string | undefined>();
  const translateY = useRef(new Animated.Value(0)).current;
  const homeTourOpen = useHomeTourUiOpen();

  const sheetOpen =
    activityOpen ||
    walletOpen ||
    fundsReceivedOpen ||
    fundsSentOpen ||
    posOpen ||
    scanOpen ||
    fiatModeSheetOpen;

  const refresh = useCallback(() => {
    void (async () => {
      if (!hasWallet) {
        setOffer(null);
        return;
      }
      const pending = await listPendingContactShares();
      setOffer(pending[0] ?? null);
      if (pending[0]) translateY.setValue(0);
    })();
  }, [hasWallet, translateY]);

  useEffect(() => {
    if (!hasWallet) {
      stopContactShareWatch();
      void import("../agent/botWatch")
        .then((m) => m.stopBotWatch())
        .catch(() => {});
      // Same spirit as gift-wrap stop — drop FCM registration on logout/wipe.
      void unregisterPushBestEffort();
      setOffer(null);
      return;
    }
    queueContactShareWatchBoot();
    void import("../agent/botWatch")
      .then((m) => m.queueBotWatchBoot())
      .catch(() => {});
    refresh();
    const unsub = subscribeContactShareInbox(refresh);
    return () => {
      unsub();
    };
  }, [hasWallet, refresh]);

  // Re-read inbox when landing on Home (catch-up / live sub may have filled it).
  useEffect(() => {
    if (!hasWallet || routeName !== "Home") return;
    refresh();
  }, [hasWallet, routeName, refresh]);

  useEffect(() => {
    return () => {
      stopContactShareWatch();
    };
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      setRouteName(navigationRef.getCurrentRoute()?.name);
    };
    syncRoute();
    const unsub = navigationRef.addListener("state", syncRoute);
    return unsub;
  }, [navigationRef]);

  const offerRef = useRef<ContactShareOffer | null>(null);
  offerRef.current = offer;

  const onDismiss = useCallback(() => {
    void (async () => {
      const current = offerRef.current;
      if (current) await dismissContactShareOffer(current.id);
      setOffer(null);
      refresh();
    })();
  }, [refresh]);

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 8 && g.dy > 0,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 64 || g.vy > 0.8) {
          Animated.timing(translateY, {
            toValue: 280,
            duration: 160,
            useNativeDriver: true,
          }).start(() => onDismissRef.current());
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  const hidden =
    sheetOpen || homeTourOpen || !offer || !hasWallet || routeName !== "Home";

  if (hidden) return null;

  const fromLabel =
    offer.fromDisplayName?.trim() || midEllipsis(offer.fromNpub, 12, 6);
  const contactName = contactDisplayName(offer.contact);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
    >
      <Animated.View
        style={[styles.dialog, { transform: [{ translateY }] }]}
        {...pan.panHandlers}
      >
        <Pressable
          style={styles.closeHit}
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss contact share"
        >
          <Text style={styles.closeX}>×</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (!navigationRef.isReady()) return;
            navigationRef.navigate("ContactShareOffer", { offerId: offer.id });
          }}
          accessibilityRole="button"
          accessibilityLabel="Open shared contact"
        >
          <Text style={styles.title}>Contact shared with you</Text>
          <Text style={styles.body}>
            {fromLabel} shared “{contactName}”. Tap to review and add or refuse.
          </Text>
          <Hint style={styles.cta}>Tap to open</Hint>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 28,
    zIndex: 56,
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.fg,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 16,
    marginTop: 0,
  },
  closeHit: {
    position: "absolute",
    top: 6,
    right: 8,
    zIndex: 2,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  closeX: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 22,
    color: colors.hint,
    lineHeight: 24,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 6,
    paddingRight: 24,
  },
  body: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 17,
  },
  cta: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 16,
  },
});
