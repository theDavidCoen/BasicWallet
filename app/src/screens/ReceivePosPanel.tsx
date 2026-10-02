/**
 * Receive POS — keypad → simplified receive (amount, QR, URI, Edit amount).
 * Layout/behavior matches main; Fiat Mode only changes the currency label/unit
 * to the network stable (BRL on mainnet, USD on Mutinynet).
 */

import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExpandableQrCode } from "../components/ExpandableQrCode";
import { BasicLogo } from "../components/BasicLogo";
import { getNetworkConfig } from "../config/network";
import {
  fetchFiatSpot,
  fiatStableForNetwork,
  formatBrlDisplay,
} from "../fiat/depixAssets";
import {
  fetchSpotRates,
  readDisplayCurrencies,
  SPOT_RATE_TTL_MS,
  type DisplayCurrencyCode,
} from "../settings/displayCurrencies";
import { colors } from "../theme/colors";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["C", "0", "⌫"],
] as const;

/** Hard cap: 21 million BTC in sats. */
const MAX_POS_SATS = 21_000_000 * 100_000_000;

type Unit = "fiat" | "sats";
type Phase = "keypad" | "receive";
/** Fiat Mode Request URI mode — keypad always types fiat; chip picks URI shape. */
type FiatRequestKind = "fiat" | "bitcoin";
type PosFiatCode = DisplayCurrencyCode | "BRL" | "USD";

function fiatMinorFactor(code: PosFiatCode): number {
  return code === "JPY" ? 1 : 100;
}

function formatFiatMinor(minor: number, code: PosFiatCode): string {
  if (code === "JPY") {
    return minor.toLocaleString("it-IT");
  }
  const major = minor / 100;
  if (code === "BRL") {
    return major.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (code === "USD") {
    return major.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return major.toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSats(sats: number): string {
  return sats.toLocaleString("en-US");
}

function satsFromFiatMinor(
  minor: number,
  code: PosFiatCode,
  rateBtc: number | undefined,
): number | null {
  if (rateBtc == null || rateBtc <= 0 || minor <= 0) return null;
  const fiat = minor / fiatMinorFactor(code);
  return Math.max(0, Math.round((fiat / rateBtc) * 100_000_000));
}

function fiatMinorFromSats(
  sats: number,
  code: PosFiatCode,
  rateBtc: number | undefined,
): number | null {
  if (rateBtc == null || rateBtc <= 0 || sats <= 0) return null;
  const fiat = (sats / 100_000_000) * rateBtc;
  return Math.max(0, Math.round(fiat * fiatMinorFactor(code)));
}

export function ReceivePosPanel({
  bip21Uri,
  onClose,
  onRequestUri,
  onRequestBrlUri,
  active = true,
  fiatMode = false,
  variant = "receive",
  contactLabel,
  onChatRequestConfirm,
  chatRequestBusy = false,
}: {
  /** Base BIP21 (boarding + ark) without amount — used when enabling Request. */
  bip21Uri: string | null;
  onClose: () => void;
  /** Build BIP21 with amount (sats) → full URI for QR. */
  onRequestUri: (amountSats: number) => string | null;
  /**
   * Fiat Mode: build stable-asset receive URI from display units.
   * When set, Request prefers this over padded sats BIP21.
   */
  onRequestBrlUri?: (fiatDisplay: number) => string | null;
  /** When false (sheet dismissed), return to keypad so the next open is fresh. */
  active?: boolean;
  /** When true, primary unit is the network stable (BRL / USD), not EUR. */
  fiatMode?: boolean;
  /**
   * `receive` = classic POS (QR).
   * `chat-request` = amount entry then publish encrypted Nostr pay-request.
   * `chat-send` = amount entry then Continue → Confirm + biometrics.
   */
  variant?: "receive" | "chat-request" | "chat-send";
  /** Shown under title when variant is chat-request / chat-send. */
  contactLabel?: string;
  /**
   * Chat request/send confirm — amount in sats.
   * When Fiat Mode keypad, `meta.fiatDisplay` is the typed stable amount.
   */
  onChatRequestConfirm?: (
    amountSats: number,
    meta?: { fiatDisplay?: number },
  ) => void | Promise<void>;
  chatRequestBusy?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const networkId = getNetworkConfig().id;
  const stable = fiatStableForNetwork(networkId);
  const stableCode = stable.displayCode;

  const [unit, setUnit] = useState<Unit>("fiat");
  const [fiatRequestKind, setFiatRequestKind] = useState<FiatRequestKind>("fiat");
  const [digits, setDigits] = useState(""); // fiat: minor units; sats: sats
  const [phase, setPhase] = useState<Phase>("keypad");
  const [requestUri, setRequestUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fiatCode, setFiatCode] = useState<PosFiatCode>(
    fiatMode ? stableCode : "EUR",
  );
  const [rate, setRate] = useState<number | undefined>();

  useEffect(() => {
    if (active) return;
    setPhase("keypad");
    setDigits("");
    setRequestUri(null);
    setCopied(false);
    setFiatRequestKind("fiat");
  }, [active]);

  useEffect(() => {
    if (fiatMode) {
      setFiatCode(stableCode);
      setUnit("fiat");
      setFiatRequestKind("fiat");
    }
  }, [fiatMode, stableCode]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const pull = async () => {
      if (fiatMode) {
        const spot = await fetchFiatSpot(networkId);
        if (!cancelled && spot != null) {
          setFiatCode(stableCode);
          setRate(spot);
        }
        return;
      }
      const s = await readDisplayCurrencies();
      if (cancelled) return;
      const code = s.enabled[0] ?? "EUR";
      setFiatCode(code);
      const rates = await fetchSpotRates([code]);
      if (!cancelled) setRate(rates[code]);
    };
    void pull();
    timer = setInterval(() => void pull(), SPOT_RATE_TTL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [fiatMode, networkId, stableCode]);

  const raw = digits === "" ? 0 : Number.parseInt(digits, 10) || 0;

  const fiatDisplay = useMemo(() => {
    if (!fiatMode) return null;
    if (unit === "fiat") return raw / 100;
    if (rate == null || raw <= 0) return 0;
    return (raw / 100_000_000) * rate;
  }, [fiatMode, raw, rate, unit]);

  const amountSats = useMemo(() => {
    if (raw <= 0) return 0;
    const sats = unit === "sats" ? raw : satsFromFiatMinor(raw, fiatCode, rate) ?? 0;
    return Math.min(sats, MAX_POS_SATS);
  }, [fiatCode, raw, rate, unit]);

  const primaryLabel = unit === "fiat" ? (fiatMode ? stableCode : fiatCode) : "SATS";
  const primaryValue =
    unit === "fiat" ? formatFiatMinor(raw, fiatCode) : formatSats(raw);

  const secondaryLine = useMemo(() => {
    if (raw <= 0) return null;
    if (unit === "fiat") {
      if (amountSats <= 0) return rate == null ? "Rate unavailable" : null;
      return `≈ ${formatSats(amountSats)} sats`;
    }
    if (fiatMode) {
      const d = fiatDisplay ?? 0;
      if (!(d > 0)) return rate == null ? "Rate unavailable" : null;
      return `≈ ${formatBrlDisplay(d, { networkId })}`;
    }
    const minor = fiatMinorFromSats(raw, fiatCode, rate);
    if (minor == null) return rate == null ? "Rate unavailable" : null;
    return `≈ ${fiatCode} ${formatFiatMinor(minor, fiatCode)}`;
  }, [amountSats, fiatCode, fiatDisplay, fiatMode, networkId, raw, rate, unit]);

  const requestAmountLabel = useMemo(() => {
    if (fiatMode) {
      const d =
        unit === "fiat" ? raw / 100 : fiatDisplay ?? 0;
      if (!(d > 0)) return formatBrlDisplay(0, { networkId });
      const primary = formatBrlDisplay(d, { networkId });
      if (amountSats > 0) return `${primary} · ≈ ${formatSats(amountSats)} sats`;
      return primary;
    }
    const satsPart = `${formatSats(amountSats)} sats`;
    const fiatMinor = fiatMinorFromSats(amountSats, fiatCode, rate);
    if (fiatMinor == null || rate == null) return satsPart;
    return `${satsPart} · ${fiatCode} ${formatFiatMinor(fiatMinor, fiatCode)}`;
  }, [amountSats, fiatCode, fiatDisplay, fiatMode, networkId, raw, rate, unit]);

  const onKey = useCallback(
    (key: string) => {
      setDigits((prev) => {
        if (key === "C") return "";
        if (key === "⌫") return prev.slice(0, -1);
        if (!/^\d$/.test(key)) return prev;
        const next = prev === "0" ? (key === "0" ? prev : key) : prev + key;
        if (next === prev) return prev;
        const n = Number.parseInt(next, 10) || 0;
        if (unit === "sats") {
          if (n > MAX_POS_SATS) return prev;
        } else {
          const sats = satsFromFiatMinor(n, fiatCode, rate);
          if (sats != null && sats > MAX_POS_SATS) return prev;
        }
        return next;
      });
    },
    [fiatCode, rate, unit],
  );

  const toggleUnit = useCallback(() => {
    setDigits((prev) => {
      const n = prev === "" ? 0 : Number.parseInt(prev, 10) || 0;
      if (n <= 0) {
        setUnit((u) => (u === "fiat" ? "sats" : "fiat"));
        return "";
      }
      if (unit === "fiat") {
        const sats = Math.min(satsFromFiatMinor(n, fiatCode, rate) ?? 0, MAX_POS_SATS);
        setUnit("sats");
        return sats > 0 ? String(sats) : "";
      }
      const capped = Math.min(n, MAX_POS_SATS);
      const minor = fiatMinorFromSats(capped, fiatCode, rate);
      setUnit("fiat");
      return minor && minor > 0 ? String(minor) : "";
    });
  }, [fiatCode, rate, unit]);

  const isChatRequest = variant === "chat-request";
  const isChatSend = variant === "chat-send";
  const isChatAmount = isChatRequest || isChatSend;

  const onRequest = useCallback(() => {
    if (chatRequestBusy) return;
    if (fiatMode) {
      // Keypad stays in fiat denomination; chip picks URI shape.
      const d =
        unit === "fiat"
          ? raw / 100
          : rate != null && raw > 0
            ? (raw / 100_000_000) * rate
            : 0;
      if (!(d > 0)) return;
      if (isChatAmount) {
        const sats =
          amountSats > 0
            ? amountSats
            : satsFromFiatMinor(Math.round(d * 100), fiatCode, rate) ?? 0;
        if (!(sats > 0) || sats > MAX_POS_SATS) return;
        void onChatRequestConfirm?.(sats, { fiatDisplay: d });
        return;
      }
      if (fiatRequestKind === "fiat" && onRequestBrlUri) {
        const uri = onRequestBrlUri(d);
        if (!uri) return;
        setRequestUri(uri);
        setPhase("receive");
        return;
      }
      // Bitcoin chip: Universal BIP21 sats, no assetid (inbound auto-converts).
      const sats =
        amountSats > 0
          ? amountSats
          : satsFromFiatMinor(Math.round(d * 100), fiatCode, rate) ?? 0;
      if (!(sats > 0) || sats > MAX_POS_SATS) return;
      const uri = onRequestUri(sats);
      if (!uri) return;
      setRequestUri(uri);
      setPhase("receive");
      return;
    }
    if (amountSats <= 0 || amountSats > MAX_POS_SATS) return;
    if (isChatAmount) {
      void onChatRequestConfirm?.(amountSats);
      return;
    }
    const uri = onRequestUri(amountSats);
    if (!uri) return;
    setRequestUri(uri);
    setPhase("receive");
  }, [
    amountSats,
    chatRequestBusy,
    fiatCode,
    fiatMode,
    fiatRequestKind,
    isChatAmount,
    onChatRequestConfirm,
    onRequestBrlUri,
    onRequestUri,
    raw,
    rate,
    unit,
  ]);

  const onEditAmount = useCallback(() => {
    setPhase("keypad");
    setRequestUri(null);
    setCopied(false);
  }, []);

  const onCopyUri = useCallback(async () => {
    if (!requestUri) return;
    await Clipboard.setStringAsync(requestUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [requestUri]);

  const padTop = Math.max(insets.top, 12) + 8;
  const padBottom = insets.bottom + 16;

  const canRequest = isChatAmount
    ? amountSats > 0 && amountSats <= MAX_POS_SATS && !chatRequestBusy
    : fiatMode
      ? ((fiatDisplay ?? 0) > 0 || (unit === "fiat" && raw > 0)) &&
        (fiatRequestKind === "fiat"
          ? Boolean(onRequestBrlUri)
          : Boolean(bip21Uri) && (amountSats > 0 || rate != null))
      : amountSats > 0 && amountSats <= MAX_POS_SATS && Boolean(bip21Uri);

  if (!isChatAmount && phase === "receive" && requestUri) {
    return (
      <View style={[styles.root, { paddingTop: padTop, paddingBottom: padBottom }]}>
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <BasicLogo onPress={onClose} scale={0.77} />
          <View style={styles.headerSide} />
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.receiveScroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>RECEIVE</Text>
          <Text style={styles.requestAmt}>{requestAmountLabel}</Text>
          <View style={styles.qrWrap}>
            <ExpandableQrCode value={requestUri} size={220} />
          </View>
          <Pressable onPress={() => void onCopyUri()} style={styles.uriBox}>
            <Text style={styles.uriText} selectable>
              {requestUri}
            </Text>
            <Text style={styles.copyHint}>{copied ? "Copied" : "Tap to copy"}</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={onEditAmount}>
            <Text style={styles.secondaryText}>Edit amount</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: padTop, paddingBottom: padBottom }]}>
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <BasicLogo onPress={onClose} scale={0.77} />
        <View style={styles.headerSide} />
      </View>

      <Text style={styles.title}>
        {isChatRequest ? "REQUEST" : isChatSend ? "SEND" : "RECEIVE"}
      </Text>
      {isChatRequest && contactLabel ? (
        <Text style={styles.chatSub}>Ask {contactLabel} via encrypted Nostr</Text>
      ) : null}
      {isChatSend && contactLabel ? (
        <Text style={styles.chatSub}>To {contactLabel} · destination locked</Text>
      ) : null}
      {fiatMode && !isChatAmount ? (
        <View style={styles.modeRow}>
          <Pressable
            style={[
              styles.modeBtn,
              fiatRequestKind === "fiat" && styles.modeBtnOn,
            ]}
            onPress={() => setFiatRequestKind("fiat")}
            accessibilityRole="button"
            accessibilityState={{ selected: fiatRequestKind === "fiat" }}
            accessibilityLabel={`${stableCode} receive`}
          >
            <Text
              style={[
                styles.modeLabel,
                fiatRequestKind === "fiat" && styles.modeLabelOn,
              ]}
            >
              {stableCode}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.modeBtn,
              fiatRequestKind === "bitcoin" && styles.modeBtnOn,
            ]}
            onPress={() => setFiatRequestKind("bitcoin")}
            accessibilityRole="button"
            accessibilityState={{ selected: fiatRequestKind === "bitcoin" }}
            accessibilityLabel="Bitcoin receive"
          >
            <Text
              style={[
                styles.modeLabel,
                fiatRequestKind === "bitcoin" && styles.modeLabelOn,
              ]}
            >
              Bitcoin
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.ccy}>{primaryLabel}</Text>
      )}

      <View style={styles.amtRow}>
        <Text
          style={styles.amt}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.35}
        >
          {primaryValue || "0"}
        </Text>
        {!fiatMode ? (
          <Pressable
            onPress={toggleUnit}
            style={styles.swapBtn}
            hitSlop={12}
            accessibilityLabel="Switch fiat and sats"
          >
            <Text style={styles.swapIco}>⇅</Text>
          </Pressable>
        ) : null}
      </View>
      {secondaryLine ? <Text style={styles.secondaryLine}>{secondaryLine}</Text> : null}

      <View style={styles.pad}>
        {KEYS.map((row, ri) => (
          <View key={`r${ri}`} style={styles.padRow}>
            {row.map((label) => (
              <Pressable
                key={label}
                style={styles.key}
                onPress={() => onKey(label)}
              >
                <Text
                  style={[
                    styles.keyLabel,
                    (label === "C" || label === "⌫") && styles.keyMuted,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <Pressable
        style={[styles.cta, (!canRequest || chatRequestBusy) && styles.ctaDisabled]}
        disabled={!canRequest || chatRequestBusy}
        onPress={onRequest}
      >
        {chatRequestBusy ? (
          <ActivityIndicator color="#000" />
        ) : isChatRequest ? (
          <Text style={styles.ctaText}>Send request</Text>
        ) : isChatSend ? (
          <Text style={styles.ctaText}>Continue</Text>
        ) : !fiatMode && !bip21Uri ? (
          <View style={styles.ctaBusy}>
            <ActivityIndicator color="#000" />
            <Text style={styles.ctaPreparing}>Preparing receive…</Text>
          </View>
        ) : fiatMode && rate == null ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.ctaText}>Request</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    minHeight: 48,
  },
  headerSide: { width: 40 },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 4,
  },
  chatSub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  modeRow: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  modeBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  modeBtnOn: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  modeLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
  },
  modeLabelOn: {
    color: colors.bg,
  },
  ccy: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    marginTop: 20,
  },
  amtRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    maxWidth: "100%",
    marginTop: 8,
    paddingHorizontal: 4,
    gap: 2,
    minHeight: 56,
  },
  amt: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 48,
    color: colors.fg,
    textAlign: "right",
    flexShrink: 1,
    maxWidth: "88%",
  },
  swapBtn: {
    paddingVertical: 8,
    paddingLeft: 2,
    paddingRight: 4,
    flexShrink: 0,
  },
  swapIco: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 22,
    color: colors.fg,
  },
  secondaryLine: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 8,
    minHeight: 18,
  },
  pad: {
    marginTop: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333",
    backgroundColor: "#141414",
    overflow: "hidden",
    flexGrow: 1,
    maxHeight: 340,
  },
  padRow: { flex: 1, flexDirection: "row" },
  key: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2a2a",
  },
  keyLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 24,
    color: colors.fg,
  },
  keyMuted: {
    fontSize: 20,
    color: colors.caption,
  },
  cta: {
    marginTop: 20,
    backgroundColor: colors.fg,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaBusy: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  ctaPreparing: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: "#000",
  },
  ctaText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 17,
    color: "#000",
  },
  receiveScroll: {
    alignItems: "center",
    paddingBottom: 32,
  },
  requestAmt: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    textAlign: "center",
    marginTop: 16,
    marginBottom: 24,
  },
  qrWrap: {
    alignItems: "center",
    marginBottom: 20,
  },
  uriBox: {
    alignSelf: "stretch",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  uriText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.fg,
    lineHeight: 18,
  },
  copyHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginTop: 8,
    textAlign: "center",
  },
  secondary: {
    alignSelf: "stretch",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    color: colors.fg,
  },
});
