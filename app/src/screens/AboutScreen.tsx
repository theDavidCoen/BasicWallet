/**
 * Penpot 05f About — logo, caption, live Arkade ASP info, version/license/GitHub.
 * ASP fields from getInfo on the configured network server (mutinynet vs mainnet).
 */

import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { RestArkProvider } from "@arkade-os/sdk";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  APP_GITHUB_LABEL,
  APP_GITHUB_URL,
  APP_GIT_COMMIT,
  APP_LICENSE_URL,
  APP_VERSION,
} from "../buildInfo";
import { getNetworkConfig } from "../config/network";
import { prettyDelta } from "../lib/prettyDelta";
import { midEllipsis } from "../nostr/keys";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

type AspRow = {
  label: string;
  value: string;
  /** Full string for clipboard; when set, row is tap-to-copy. */
  copyValue?: string;
};

type AspState =
  | { status: "loading" }
  | { status: "ok"; rows: AspRow[] }
  | { status: "error"; message: string; rows: AspRow[] };

const COPYABLE_LABELS = new Set([
  "Server URL",
  "Server pubkey",
  "Forfeit address",
]);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function bigintToNumber(v: bigint | number | string | undefined | null): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildRowsFromInfo(
  serverUrl: string,
  info: {
    signerPubkey?: string;
    forfeitAddress?: string;
    network?: string;
    dust?: bigint | number | string;
    sessionDuration?: bigint | number | string;
    boardingExitDelay?: bigint | number | string;
    unilateralExitDelay?: bigint | number | string;
  },
): AspRow[] {
  const pubkey = info.signerPubkey?.trim() || "";
  const forfeit = info.forfeitAddress?.trim() || "";
  return [
    { label: "Server URL", value: serverUrl, copyValue: serverUrl },
    {
      label: "Server pubkey",
      value: pubkey ? midEllipsis(pubkey, 11, 11) : "—",
      copyValue: pubkey || undefined,
    },
    {
      label: "Forfeit address",
      value: forfeit ? midEllipsis(forfeit, 11, 11) : "—",
      copyValue: forfeit || undefined,
    },
    { label: "Network", value: info.network?.trim() || "—" },
    { label: "Dust", value: `${bigintToNumber(info.dust)} sats` },
    {
      label: "Session duration",
      value: prettyDelta(bigintToNumber(info.sessionDuration), true) || "—",
    },
    {
      label: "Boarding exit delay",
      value: prettyDelta(bigintToNumber(info.boardingExitDelay), true) || "—",
    },
    {
      label: "Unilateral exit delay",
      value: prettyDelta(bigintToNumber(info.unilateralExitDelay), true) || "—",
    },
    { label: "Wallet mode", value: "hd" },
    { label: "Git commit hash", value: APP_GIT_COMMIT },
  ];
}

function staticFallbackRows(serverUrl: string, networkId: string): AspRow[] {
  return [
    { label: "Server URL", value: serverUrl, copyValue: serverUrl },
    { label: "Server pubkey", value: "—" },
    { label: "Forfeit address", value: "—" },
    { label: "Network", value: networkId === "mutinynet" ? "mutinynet" : "bitcoin" },
    { label: "Dust", value: "—" },
    { label: "Session duration", value: "—" },
    { label: "Boarding exit delay", value: "—" },
    { label: "Unilateral exit delay", value: "—" },
    { label: "Wallet mode", value: "hd" },
    { label: "Git commit hash", value: APP_GIT_COMMIT },
  ];
}

export function AboutScreen() {
  const { t } = useI18n();
  const [asp, setAsp] = useState<AspState>({ status: "loading" });
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyText = useCallback(async (label: string, text: string) => {
    if (!text || text === "—") return;
    await Clipboard.setStringAsync(text);
    setCopiedLabel(label);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedLabel(null), 1500);
  }, []);

  const openLicense = useCallback(() => {
    // Placeholder until LICENSE exists on GitHub (Mind: basic-wallet).
    if (!APP_LICENSE_URL) return;
    void Linking.openURL(APP_LICENSE_URL);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const network = getNetworkConfig();
      setAsp({ status: "loading" });

      void (async () => {
        try {
          const provider = new RestArkProvider(network.arkServerUrl);
          const info = await withTimeout(provider.getInfo(), 12_000, "getInfo");
          if (cancelled) return;
          setAsp({
            status: "ok",
            rows: buildRowsFromInfo(network.arkServerUrl, info),
          });
        } catch (e) {
          if (cancelled) return;
          setAsp({
            status: "error",
            message:
              e instanceof Error ? e.message : "Arkade server unreachable",
            rows: staticFallbackRows(network.arkServerUrl, network.id),
          });
        }
      })();

      return () => {
        cancelled = true;
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
      };
    }, []),
  );

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={ui.title}>{t("about.title")}</Text>
        <Text style={styles.caption}>{t("about.caption")}</Text>

        <Text style={styles.section}>ARKADE</Text>

        {asp.status === "loading" ? (
          <View style={styles.card}>
            <ActivityIndicator color={colors.fg} />
            <Text style={[styles.err, { marginTop: 12 }]}>Loading ASP info…</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {asp.status === "error" ? (
              <Text style={styles.errBanner}>Arkade server unreachable</Text>
            ) : null}
            {asp.rows.map((row, i) => {
              const canCopy =
                COPYABLE_LABELS.has(row.label) && Boolean(row.copyValue);
              const showCopied = copiedLabel === row.label;
              const valueNode = (
                <Text
                  style={[styles.kvValue, canCopy && styles.kvValueCopyable]}
                  numberOfLines={2}
                >
                  {showCopied ? "Copied" : row.value}
                </Text>
              );
              return (
                <View
                  key={row.label}
                  style={[styles.kvRow, i > 0 && styles.kvDivider]}
                >
                  <Text style={styles.kvLabel}>{row.label}</Text>
                  {canCopy ? (
                    <Pressable
                      style={styles.kvValuePress}
                      onPress={() => void copyText(row.label, row.copyValue!)}
                      accessibilityRole="button"
                      accessibilityLabel={`Copy ${row.label}`}
                    >
                      {valueNode}
                    </Pressable>
                  ) : (
                    valueNode
                  )}
                </View>
              );
            })}
          </View>
        )}

        {asp.status === "error" ? (
          <Text style={styles.errDetail}>{asp.message}</Text>
        ) : null}

        <Text style={styles.footerLine}>Version  {APP_VERSION}</Text>
        <Pressable
          onPress={openLicense}
          accessibilityRole="link"
          accessibilityLabel="License Open source"
        >
          <Text style={[styles.footerLine, styles.footerLink]}>
            License  ·  Open source
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void Linking.openURL(APP_GITHUB_URL);
          }}
          accessibilityRole="link"
          accessibilityLabel={`Open GitHub ${APP_GITHUB_LABEL}`}
        >
          <Text style={styles.github}>GitHub  ·  {APP_GITHUB_LABEL}</Text>
        </Pressable>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 40 },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 20,
  },
  section: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 11,
    color: colors.hint,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333333",
    paddingVertical: 4,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  kvRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
  },
  kvDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2A2A2A",
  },
  kvLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    flexShrink: 0,
    maxWidth: "42%",
  },
  kvValuePress: {
    flex: 1,
  },
  kvValue: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 11,
    color: colors.fg,
    textAlign: "right",
    flex: 1,
  },
  kvValueCopyable: {
    textDecorationLine: "underline",
  },
  errBanner: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: "#E07070",
    paddingVertical: 8,
  },
  err: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
  },
  errDetail: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 16,
  },
  footerLine: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginTop: 8,
  },
  footerLink: {
    textDecorationLine: "underline",
  },
  github: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 8,
    textDecorationLine: "underline",
  },
});
