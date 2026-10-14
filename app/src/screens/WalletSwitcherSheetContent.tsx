/**
 * Wallet switcher body for InteractiveBottomSheet (no ScreenChrome).
 * Greeting + Share npub sit above the existing Wallets list.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, Caption, ScreenTitle, SectionHeader } from "../components/ui";
import { useI18n } from "../i18n";
import {
  readPublicIdentity,
  type NostrPublicIdentity,
} from "../nostr/identityStore";
import { midEllipsis } from "../nostr/keys";
import { shareSafe } from "../security/shareSafe";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { sheetUi } from "../theme/sheetUi";

type Props = {
  onClose: () => void;
  onAddWallet: () => void;
  onEditWallet: (walletId: string) => void;
  onConnectNode: () => void;
  onOpenNostrIdentity: () => void;
};

function greetingDisplay(id: NostrPublicIdentity | null): string {
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
  const { wallets, selectedWallet, selectWallet, refreshWalletList } = useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<NostrPublicIdentity | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    refreshWalletList();
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

  const display = greetingDisplay(identity);
  const canShare = Boolean(identity?.npub);

  return (
    <View style={styles.root}>
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

      <SectionHeader first style={styles.walletsHeader}>
        {t("home.walletsSection")}
      </SectionHeader>
      <Caption style={styles.walletsCaption}>{t("home.walletsSelectCaption")}</Caption>

      <FlatList
        data={wallets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <View>
            <Button size="sheet" onPress={() => onAddWallet()}>
              {t("home.walletsCreate")}
            </Button>
            <Button size="sheet" onPress={() => onConnectNode()}>
              {t("home.walletsConnectLn")}
            </Button>
          </View>
        }
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
    marginTop: 8,
    marginBottom: 0,
    textAlign: "center",
  },
  walletsCaption: {
    ...sheetUi.caption,
    marginTop: 4,
    marginBottom: 12,
  },
  list: { paddingBottom: 24, gap: 8 },
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
