import { paintThen } from "../runtime/paintThen";
/**
 * Wallet switcher body for InteractiveBottomSheet (no ScreenChrome).
 * Greeting + Share npub above a flex-growing wallets list; CTAs are fixed chips.
 * Visible wallet count follows display/sheet height (natural card size + peek).
 */

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Button, Caption, ScreenTitle } from "../components/ui";
import { useI18n } from "../i18n";
import {
  readPublicIdentity,
  type NostrPublicIdentity,
} from "../nostr/identityStore";
import { midEllipsis } from "../nostr/keys";
import { shareSafe } from "../security/shareSafe";
import { useWalletList } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { radii } from "../theme/radii";
import { sheetUi } from "../theme/sheetUi";

type Props = {
  onClose: () => void;
  onAddWallet: () => void;
  onEditWallet: (walletId: string) => void;
  onConnectNode: () => void;
  onOpenNostrIdentity: () => void;
};

const ROW_GAP = 8;
/** Floor so short phones still show ~2 cards + peek before chips. */
const LIST_MIN_H = 72 * 2 + ROW_GAP + 36;

/**
 * Prefer Display name, then NIP-05, then compressed npub.
 */
function greetingDisplay(id: NostrPublicIdentity | null): string {
  const displayName = id?.profile?.displayName?.trim();
  if (displayName) return displayName;
  const nip05 = id?.profile?.nip05?.trim();
  if (nip05) return nip05;
  if (id?.npub) return midEllipsis(id.npub, 5, 3);
  return "…";
}

export function WalletSwitcherSheetContent({
  onClose,
  onAddWallet,
  onEditWallet,
  onConnectNode,
  onOpenNostrIdentity,
}: Props) {
  const { t } = useI18n();
  const { wallets, selectedWallet, selectWallet, refreshWalletList } = useWalletList();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<NostrPublicIdentity | null>(null);
  const [sharing, setSharing] = useState(false);
  const [listH, setListH] = useState(0);
  const [contentH, setContentH] = useState(0);

  useEffect(() => {
    paintThen(() => { refreshWalletList(); });
  }, [refreshWalletList]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = await readPublicIdentity();
      if (!cancelled) setIdentity(id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelect = useCallback(
    async (id: string) => {
      if (id === selectedWallet?.id) {
        onClose();
        return;
      }
      setBusyId(id);
      try {
        await selectWallet(id);
        onClose();
      } catch (e) {
        console.warn("[basic] selectWallet failed", e);
      } finally {
        setBusyId(null);
      }
    },
    [onClose, selectWallet, selectedWallet?.id],
  );

  const onShareNpub = useCallback(async () => {
    if (!identity?.npub || sharing) return;
    setSharing(true);
    try {
      await shareSafe({ message: identity.npub });
    } catch (e) {
      console.warn("[basic] share npub failed", e);
    } finally {
      setSharing(false);
    }
  }, [identity?.npub, sharing]);

  const onListLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setListH(h);
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    if (h > 0) setContentH(h);
  }, []);

  // Overflow → scroll; last card peeks naturally in the flex viewport.
  const listScrollEnabled = contentH > listH + 2;

  const display = greetingDisplay(identity);
  const canShare = Boolean(identity?.npub);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <ScreenTitle style={sheetUi.title}>
          {t("home.walletsHiTitle", { display })}
        </ScreenTitle>
        <Caption style={sheetUi.caption}>{t("home.walletsHiCaption")}</Caption>
        <Pressable
          onPress={onOpenNostrIdentity}
          hitSlop={8}
          accessibilityRole="link"
          style={styles.identityLinkHit}
        >
          <Text style={styles.identityLink}>{t("home.walletsHiNostrLink")}</Text>
        </Pressable>

        <Button
          size="sheet"
          variant="secondary"
          disabled={!canShare || sharing}
          onPress={() => void onShareNpub()}
          style={styles.shareBtn}
        >
          {t("nostr.shareNpub")}
        </Button>

        <ScreenTitle style={styles.walletsHeader}>
          {t("home.walletsSection")}
        </ScreenTitle>
        <Caption style={styles.walletsCaption}>{t("home.walletsSelectCaption")}</Caption>
      </View>

      <View style={styles.listWrap} onLayout={onListLayout}>
        <FlatList
          data={wallets}
          keyExtractor={(item) => item.id}
          style={styles.listFlex}
          scrollEnabled={listScrollEnabled}
          nestedScrollEnabled
          showsVerticalScrollIndicator={listScrollEnabled}
          contentContainerStyle={styles.list}
          onContentSizeChange={onContentSizeChange}
          renderItem={({ item }) => {
            const selected = item.id === selectedWallet?.id;
            const busy = busyId === item.id;
            return (
              <View style={[styles.row, selected && styles.rowOn]}>
                <Pressable
                  style={styles.rowMain}
                  onPress={() => void onSelect(item.id)}
                  disabled={busyId !== null}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(item.label[0] ?? "?").toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{item.label}</Text>
                    <Text style={styles.rowSub}>
                      {item.kind}
                      {item.tag ? ` · ${item.tag}` : ""}
                      {selected ? ` · ${t("home.walletsSelected")}` : ""}
                    </Text>
                  </View>
                  {busy ? <ActivityIndicator color={colors.fg} /> : null}
                </Pressable>
                <Pressable
                  style={styles.chevronHit}
                  hitSlop={12}
                  onPress={() => {
                    onEditWallet(item.id);
                  }}
                  disabled={busyId !== null}
                >
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              </View>
            );
          }}
        />
      </View>

      <View style={styles.chips}>
        <Pressable
          style={styles.chip}
          onPress={() => onAddWallet()}
          accessibilityRole="button"
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {t("home.walletsCreate")}
          </Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => onConnectNode()}
          accessibilityRole="button"
        >
          <Text style={styles.chipText} numberOfLines={2}>
            {t("home.walletsConnectLn")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexShrink: 0,
  },
  identityLinkHit: {
    alignSelf: "center",
    marginBottom: 12,
  },
  identityLink: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.fg,
    textDecorationLine: "underline",
    textAlign: "center",
  },
  shareBtn: {
    marginTop: 0,
    marginBottom: 8,
  },
  walletsHeader: {
    fontSize: 16,
    color: colors.fg,
    marginTop: 8,
    marginBottom: 0,
    textAlign: "center",
  },
  walletsCaption: {
    ...sheetUi.caption,
    marginTop: 4,
    marginBottom: 12,
  },
  /** Grows with sheet/display height — more wallets on tall phones. */
  listWrap: {
    flex: 1,
    minHeight: LIST_MIN_H,
    marginBottom: 12,
  },
  listFlex: {
    flex: 1,
  },
  list: {
    gap: ROW_GAP,
    paddingBottom: 4,
    flexGrow: 0,
  },
  chips: {
    flexDirection: "row",
    flexShrink: 0,
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  chip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  chipText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.fg,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingLeft: 12,
    paddingVertical: 4,
  },
  rowOn: { borderColor: colors.fg },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  rowSub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    marginTop: 2,
  },
  chevronHit: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    justifyContent: "center",
  },
  chevron: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 22,
    color: "#666666",
  },
});
