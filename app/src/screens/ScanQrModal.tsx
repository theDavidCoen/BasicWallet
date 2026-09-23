/**
 * Full-screen QR scanner (Penpot 03f).
 * Callers supply parse() — Send Arkade / Lightning, Connect LNDHub / BTCPay.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isValidArkAddress } from "@arkade-os/sdk";
import { looksLikeBolt11, normalizeBolt11 } from "../lightning/lndhub";
import { colors } from "../theme/colors";

export function extractArkAddressFromScan(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (isValidArkAddress(t)) return t;

  try {
    if (t.includes(":")) {
      const withoutScheme = t.replace(/^[a-z][a-z0-9+.-]*:/i, "");
      const path = withoutScheme.split("?")[0]?.replace(/^\/\//, "") ?? "";
      const candidate = path.split(/[/?#\s]/)[0] ?? "";
      if (isValidArkAddress(candidate)) return candidate;
      const params = new URLSearchParams(withoutScheme.split("?")[1] ?? "");
      for (const key of ["ark", "address", "addr", "to"]) {
        const v = params.get(key);
        if (v && isValidArkAddress(v)) return v;
      }
    }
  } catch {
    /* fall through */
  }

  const m = t.match(/\b(t?ark1[0-9a-z]{20,})\b/i);
  if (m?.[1] && isValidArkAddress(m[1])) return m[1];
  return null;
}

/** BOLT11 / lightning:… from Phoenix, LNbits, etc. */
export function extractBolt11FromScan(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (looksLikeBolt11(t)) return normalizeBolt11(t);
  // Some wallets embed invoice in a URL query
  try {
    const m = t.match(/(ln(bc|tb|bcrt|sb)[0-9a-z]+)/i);
    if (m?.[1] && looksLikeBolt11(m[1])) return normalizeBolt11(m[1]);
  } catch {
    /* */
  }
  return null;
}

/**
 * BOLT11, LNURL, Lightning Address, BIP353, or BOLT12 offer from a QR.
 * Returns the trimmed payload for Send (resolution happens later).
 */
export function extractLightningPayFromScan(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  const bolt11 = extractBolt11FromScan(t);
  if (bolt11) return bolt11;

  // lightning:LNURL1… / lightning:lno1…
  let body = t;
  if (/^lightning:/i.test(body)) {
    body = body.replace(/^lightning:/i, "").trim();
  }

  if (/^lnurl1/i.test(body)) return body;
  if (/^lno1/i.test(body)) return body;
  if (/^https?:\/\//i.test(body) && /lnurl/i.test(body)) return body;

  // BIP353 / Lightning Address (optional ₿ prefix)
  const addr = body.replace(/^₿/, "");
  if (/^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(addr)) {
    return addr;
  }

  // bitcoin:?lightning=… / bitcoin:?lno=…
  if (/^bitcoin:/i.test(t)) {
    try {
      const q = t.indexOf("?");
      if (q >= 0) {
        const params = new URLSearchParams(t.slice(q + 1));
        const ln = params.get("lightning") || params.get("ln");
        if (ln && looksLikeBolt11(ln)) return normalizeBolt11(ln);
        const lno = params.get("lno") || params.get("offer");
        if (lno && /^lno1/i.test(lno)) return lno;
      }
    } catch {
      /* */
    }
  }

  return null;
}

type ScanQrViewProps = {
  /** When false, camera pauses and lock resets. */
  active: boolean;
  /**
   * When false, camera still runs but accepted QRs wait until true
   * (wallet Keystore still opening). Cancel never waits.
   */
  acceptScans?: boolean;
  onClose: () => void;
  /** Return non-null when the QR is accepted (destination string). */
  parse?: (raw: string) => string | null;
  /**
   * Called with the accepted destination. Second arg is the raw QR payload
   * (e.g. full BIP21) so callers can read amount= without re-scanning.
   */
  onScan: (value: string, raw?: string) => void;
  title?: string;
  idleHint?: string;
  rejectHint?: string;
};

export function ScanQrView({
  active,
  acceptScans = true,
  onClose,
  onScan,
  parse = extractArkAddressFromScan,
  title = "SCAN",
  idleHint = "Point at the QR code to pay",
  rejectHint = "Not recognized — try again",
}: ScanQrViewProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);
  const lastRejectAt = useRef(0);
  const pendingRef = useRef<{ value: string; raw: string } | null>(null);
  const [hint, setHint] = useState(idleHint);
  const [torch, setTorch] = useState(false);

  useEffect(() => {
    if (!active) {
      locked.current = false;
      lastRejectAt.current = 0;
      pendingRef.current = null;
      setHint(idleHint);
      setTorch(false);
      return;
    }
    setHint(idleHint);
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [active, permission, requestPermission, idleHint]);

  // Flush a scan that landed while the wallet was still opening.
  useEffect(() => {
    if (!active || !acceptScans) return;
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    locked.current = true;
    onScan(pending.value, pending.raw);
    onClose();
  }, [active, acceptScans, onClose, onScan]);

  const onBarcode = useCallback(
    (result: BarcodeScanningResult) => {
      if (!active || locked.current) return;
      const data = result.data?.trim() ?? "";
      if (!data) return;
      const value = parse(data);
      if (!value) {
        const now = Date.now();
        // Dense LN QRs fire many frames — throttle reject spam.
        if (now - lastRejectAt.current > 1200) {
          lastRejectAt.current = now;
          setHint(rejectHint);
        }
        return;
      }
      if (!acceptScans) {
        pendingRef.current = { value, raw: data };
        locked.current = true;
        setHint("Wallet still syncing — hold on…");
        return;
      }
      locked.current = true;
      onScan(value, data);
      onClose();
    },
    [acceptScans, active, onClose, onScan, parse, rejectHint],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.caption}>{hint}</Text>

      <View style={styles.frame}>
        {!permission ? (
          <ActivityIndicator color={colors.fg} />
        ) : !permission.granted ? (
          <View style={styles.permBox}>
            <Text style={styles.permText}>Camera access is required to scan.</Text>
            <Pressable style={styles.primary} onPress={() => void requestPermission()}>
              <Text style={styles.primaryText}>Allow camera</Text>
            </Pressable>
          </View>
        ) : active ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            // Continuous AF helps dense BOLT11 QRs (Phoenix / LNbits).
            autofocus="on"
            // Mild zoom so modules fill more of the sensor without clipping.
            zoom={0.08}
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onBarcode}
          />
        ) : (
          <View style={StyleSheet.absoluteFill} />
        )}
        {/* Corner marks only — full-bleed decode; small box hurt dense invoices. */}
        <View style={styles.corners} pointerEvents="none">
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
      </View>

      <Text style={styles.tip}>
        Fill most of the frame. Hold steady — Lightning invoices are dense.
      </Text>

      <View style={styles.actions}>
        {permission?.granted ? (
          <Pressable
            style={[styles.torchBtn, torch && styles.torchOn]}
            onPress={() => setTorch((v) => !v)}
          >
            <Text style={[styles.torchText, torch && styles.torchTextOn]}>
              {torch ? "Torch on" : "Torch"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondary} onPress={onClose}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onScan: (value: string, raw?: string) => void;
  parse?: (raw: string) => string | null;
  title?: string;
  idleHint?: string;
  rejectHint?: string;
};

/** Modal wrapper for Send / Connect flows. Home swipe uses ScanQrView in a side sheet. */
export function ScanQrModal({
  visible,
  onClose,
  onScan,
  parse,
  title,
  idleHint,
  rejectHint,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScanQrView
        active={visible}
        onClose={onClose}
        onScan={onScan}
        parse={parse}
        title={title}
        idleHint={idleHint}
        rejectHint={rejectHint}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 12,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 12,
  },
  frame: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.fg,
    overflow: "hidden",
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 280,
  },
  corners: {
    ...StyleSheet.absoluteFill,
    margin: 28,
  },
  corner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: colors.fg,
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  tip: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 16,
  },
  permBox: {
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 16,
  },
  permText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
  },
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.bg,
  },
  actions: {
    marginTop: 12,
    marginBottom: 8,
    gap: 10,
  },
  torchBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  torchOn: {
    borderColor: colors.fg,
    backgroundColor: "#1a1a1a",
  },
  torchText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
  },
  torchTextOn: {
    color: colors.fg,
  },
  secondary: {
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
