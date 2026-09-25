/**
 * Receive POS — keypad → simplified receive (amount, QR, URI, Edit amount).
 * In Fiat Mode the primary unit is BRL (DePix), not display-currency EUR/USD.
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
import { fetchBtcBrlSpot, formatBrlDisplay } from "../fiat/depixAssets";
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

function fiatMinorFactor(code: DisplayCurrencyCode | "BRL"): number {
  return code === "JPY" ? 1 : 100;
}

function formatFiatMinor(minor: number, code: DisplayCurrencyCode | "BRL"): string {
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
  code: DisplayCurrencyCode | "BRL",
  rateBtc: number | undefined,
): number | null {
  if (rateBtc == null || rateBtc <= 0 || minor <= 0) return null;
  const fiat = minor / fiatMinorFactor(code);
  return Math.max(0, Math.round((fiat / rateBtc) * 100_000_000));
}

function fiatMinorFromSats(
  sats: number,
  code: DisplayCurrencyCode | "BRL",
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
}: {
  /** Base BIP21 (boarding + ark) without amount — used when enabling Request. */
  bip21Uri: string | null;
  onClose: () => void;
  /** Build BIP21 with amount (sats) → full URI for QR. */
  onRequestUri: (amountSats: number) => string | null;
  /**
   * Fiat Mode: build DePix/BRL receive URI from display units.
   * When set, Request prefers this over padded sats BIP21.
   */
  onRequestBrlUri?: (brlDisplay: number) => string | null;
  /** When false (sheet dismissed), return to keypad so the next open is fresh. */
  active?: boolean;
  /** When true, primary unit is BRL (not EUR/USD display currencies). */
  fiatMode?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [unit, setUnit] = useState<Unit>("fiat");
  const [digits, setDigits] = useState(""); // fiat: minor units; sats: sats
  const [phase, setPhase] = useState<Phase>("keypad");
  const [requestUri, setRequestUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fiatCode, setFiatCode] = useState<DisplayCurrencyCode | "BRL">(
    fiatMode ? "BRL" : "EUR",
  );
  const [rate, setRate] = useState<number | undefined>();

  useEffect(() => {
    if (active) return;
    setPhase("keypad");
    setDigits("");
    setRequestUri(null);
    setCopied(false);
  }, [active]);

  useEffect(() => {
    if (fiatMode) {
      setFiatCode("BRL");
      setUnit("fiat");
    }
  }, [fiatMode]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const pull = async () => {
      if (fiatMode) {
        const spot = await fetchBtcBrlSpot();
        if (!cancelled && spot != null) {
          setFiatCode("BRL");
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
  }, [fiatMode]);

  const raw = digits === "" ? 0 : Number.parseInt(digits, 10) || 0;

  const brlDisplay = useMemo(() => {
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

  const primaryLabel = unit === "fiat" ? (fiatMode ? "BRL" : fiatCode) : "SATS";
  const primaryValue =
    unit === "fiat" ? formatFiatMinor(raw, fiatCode) : formatSats(raw);

  const secondaryLine = useMemo(() => {
    if (raw <= 0) return null;
    if (unit === "fiat") {
      if (amountSats <= 0) return rate == null ? "Rate unavailable" : null;
      return `≈ ${formatSats(amountSats)} sats`;
    }
    if (fiatMode) {
      const brl = brlDisplay ?? 0;
      if (!(brl > 0)) return rate == null ? "Rate unavailable" : null;
      return `≈ ${formatBrlDisplay(brl)}`;
    }
    const minor = fiatMinorFromSats(raw, fiatCode, rate);
    if (minor == null) return rate == null ? "Rate unavailable" : null;
    return `≈ ${fiatCode} ${formatFiatMinor(minor, fiatCode)}`;
  }, [amountSats, brlDisplay, fiatCode, fiatMode, raw, rate, unit]);

  const requestAmountLabel = useMemo(() => {
    if (fiatMode) {
      const brl =
        unit === "fiat"
          ? raw / 100
          : brlDisplay ?? 0;
      if (!(brl > 0)) return formatBrlDisplay(0);
      const primary = formatBrlDisplay(brl);
      if (amountSats > 0) return `${primary} · ≈ ${formatSats(amountSats)} sats`;
      return primary;
    }
    const satsPart = `${formatSats(amountSats)} sats`;
    const fiatMinor = fiatMinorFromSats(amountSats, fiatCode, rate);
    if (fiatMinor == null || rate == null) return satsPart;
    return `${satsPart} · ${fiatCode} ${formatFiatMinor(fiatMinor, fiatCode)}`;
  }, [amountSats, brlDisplay, fiatCode, fiatMode, raw, rate, unit]);

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

  const onRequest = useCallback(() => {
    if (fiatMode && onRequestBrlUri) {
      const brl =
        unit === "fiat"
          ? raw / 100
          : rate != null && raw > 0
            ? (raw / 100_000_000) * rate
            : 0;
      if (!(brl > 0)) return;
      const uri = onRequestBrlUri(brl);
      if (!uri) return;
      setRequestUri(uri);
      setPhase("receive");
      return;
    }
    if (amountSats <= 0 || amountSats > MAX_POS_SATS) return;
    const uri = onRequestUri(amountSats);
    if (!uri) return;
    setRequestUri(uri);
    setPhase("receive");
  }, [amountSats, fiatMode, onRequestBrlUri, onRequestUri, raw, rate, unit]);

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

  const canRequest = fiatMode
    ? (brlDisplay ?? 0) > 0 || (unit === "fiat" && raw > 0)
    : amountSats > 0 && amountSats <= MAX_POS_SATS && Boolean(bip21Uri);

  if (phase === "receive" && requestUri) {
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

      <Text style={styles.title}>RECEIVE</Text>
      <Text style={styles.ccy}>{primaryLabel}</Text>

      <View style={styles.amtRow}>
        <Text
          style={styles.amt}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.35}
        >
          {primaryValue || "0"}
        </Text>
        <Pressable
          onPress={toggleUnit}
          style={styles.swapBtn}
          hitSlop={12}
          accessibilityLabel={fiatMode ? "Switch BRL and sats" : "Switch fiat and sats"}
        >
          <Text style={styles.swapIco}>⇅</Text>
        </Pressable>
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
        style={[styles.primary, !canRequest && styles.primaryDisabled]}
        disabled={!canRequest}
        onPress={onRequest}
        accessibilityRole="button"
        accessibilityLabel="Request"
      >
        {rate == null && unit === "fiat" ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.primaryText}>Request</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  headerSide: { width: 44 },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: 6,
  },
  ccy: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginBottom: 4,
  },
  amtRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 56,
    marginBottom: 4,
  },
  amt: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 40,
    color: colors.fg,
    flexShrink: 1,
    textAlign: "center",
  },
  swapBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  swapIco: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
  },
  secondaryLine: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 12,
  },
  pad: {
    flexGrow: 1,
    justifyContent: "center",
    gap: 10,
    marginVertical: 8,
  },
  padRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  key: {
    flex: 1,
    aspectRatio: 1.35,
    maxHeight: 72,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  keyLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 22,
    color: colors.fg,
  },
  keyMuted: {
    color: colors.caption,
    fontSize: 18,
  },
  primary: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  primaryDisabled: {
    opacity: 0.4,
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
  },
  receiveScroll: {
    alignItems: "center",
    paddingBottom: 24,
  },
  requestAmt: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 16,
  },
  qrWrap: {
    marginBottom: 16,
  },
  uriBox: {
    alignSelf: "stretch",
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
  },
  uriText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    textAlign: "center",
  },
  copyHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 8,
  },
  secondary: {
    alignSelf: "stretch",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
});
