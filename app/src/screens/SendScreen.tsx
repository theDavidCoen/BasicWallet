import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInput as TextInputType,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import Svg, { Path, Rect } from "react-native-svg";
import { isBtcAddress, isValidArkAddress } from "@arkade-os/sdk";
import type { NormalizedExtendedVirtualCoin } from "@arkade-os/sdk";
import type { RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { InteractiveBottomSheet } from "../components/sheet/InteractiveBottomSheet";
import { getNetworkConfig } from "../config/network";
import { upsertLightningPayments } from "../account/lightningActivity";
import { recordSentFromThisDevice, notePendingSendFromThisDevice } from "../account/txMeta";
import { lndhubPayInvoice, parseBolt11AmountSats } from "../lightning/lndhub";
import {
  looksLikeLightningPayInput,
  probeLightningPay,
  resolveLightningPay,
  type LnPayProbe,
} from "../lightning/lnPayResolve";
import { loadLndHubCredentials } from "../lightning/lndhubCredentials";
import { requireUserPresence } from "../security/userPresence";
import { useSheets } from "../navigation/SheetHost";
import { colors } from "../theme/colors";
import { readCachedArkAddress, writeCachedArkAddress } from "../wallet/addressCache";
import { peekArkAddress, type BasicWallet } from "../wallet/hdWallet";
import { useWallet } from "../wallet/WalletProvider";
import { formatSatsLabel } from "../wallet/formatSats";
import { ScanQrModal, extractLightningPayFromScan, extractArkAddressFromScan } from "./ScanQrModal";
import { resolvePayIntent } from "../wallet/bip21Pay";
import type { WalletRecord } from "../account/walletRegistry";

/** Hard cap — SDK send often hangs after ASP already settled the payment. */
const SEND_TIMEOUT_MS = 45_000;
/** LNDHub can hang after payment already settled. */
const LN_SEND_TIMEOUT_MS = 30_000;
/** Give send() a brief moment to return the real txid after spend is visible. */
const TXID_GRACE_MS = 1_500;
const SPEND_POLL_MS = 350;
/** Mainnet / mutinynet ASP dust (min vtxo). SDK still emits subdust change; ASP rejects it. */
const DEFAULT_MIN_VTXO_SATS = 330;

function truncateDest(value: string, head = 10, tail = 8): string {
  const t = value.trim();
  if (t.length <= head + tail + 1) return t;
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}

function IconEnter({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect
        x={3.5}
        y={5.5}
        width={17}
        height={13}
        rx={2}
        stroke={colors.fg}
        strokeWidth={1.6}
        fill="none"
      />
      <Path
        d="M7 15.5h6.5M13.5 15.5l-2.2-2.2M13.5 15.5l-2.2 2.2"
        stroke={colors.fg}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function IconPaste({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d="M9 5.5h6a1.5 1.5 0 0 1 1.5 1.5v1H19a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V9.5A1.5 1.5 0 0 1 5 8h2.5V7A1.5 1.5 0 0 1 9 5.5Z"
        stroke={colors.fg}
        strokeWidth={1.6}
        fill="none"
      />
      <Path
        d="M9 8h6V7a.5.5 0 0 0-.5-.5h-5A.5.5 0 0 0 9 7v1Z"
        stroke={colors.fg}
        strokeWidth={1.6}
        fill="none"
      />
    </Svg>
  );
}

function IconMyWallets({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect
        x={3.5}
        y={7}
        width={14}
        height={10}
        rx={1.8}
        stroke={colors.fg}
        strokeWidth={1.6}
        fill="none"
      />
      <Path d="M17.5 11.5h3v3h-3" stroke={colors.fg} strokeWidth={1.6} fill="none" />
      <Path
        d="M6.5 5.5h11"
        stroke={colors.fg}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

function IconQr({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d="M4 4h6v6H4V4Zm2 2v2h2V6H6Zm8-2h6v6h-6V4Zm2 2v2h2V6h-2ZM4 14h6v6H4v-6Zm2 2v2h2v-2H6Zm10 0h2v2h-2v-2Zm-2-2h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-2 4h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2h-2v-2Zm4 0h2v2h-2v-2Z"
        fill={colors.fg}
      />
    </Svg>
  );
}

/** Local alias — matches Wallet.getSpendableVtxos() / SendParams.selectedVtxos. */
type SpendableVtxo = NormalizedExtendedVirtualCoin;

type DustSafeSendPlan = {
  amount: number;
  /** When set, pass through to wallet.send so SDK does not re-select into dust change. */
  selectedVtxos?: SpendableVtxo[];
  /** True when amount was raised to consume an awkward coin set (change would be dust). */
  amountBumped: boolean;
  originalAmount: number;
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractSendTxid(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "txid" in raw) {
    const t = (raw as { txid?: unknown }).txid;
    if (typeof t === "string" && t) return t;
  }
  return String(raw ?? "");
}

async function readSpendableAvailable(w: {
  getSpendableVtxos?: () => Promise<Array<{ value?: number }>>;
}): Promise<number | null> {
  if (typeof w.getSpendableVtxos !== "function") return null;
  try {
    const list = await withTimeout(w.getSpendableVtxos(), 1_200, "getSpendableVtxos");
    let available = 0;
    for (const v of list) available += Number(v.value ?? 0);
    return available;
  } catch {
    return null;
  }
}

function vtxoBatchExpiry(v: SpendableVtxo): number {
  const fromStatus = Number(v.virtualStatus?.batchExpiry);
  if (Number.isFinite(fromStatus) && fromStatus > 0) return fromStatus;
  const fromDate = v.expiresAt instanceof Date ? v.expiresAt.getTime() : Number.NaN;
  if (Number.isFinite(fromDate) && fromDate > 0) return fromDate;
  return Number.MAX_SAFE_INTEGER;
}

function vtxoKey(v: SpendableVtxo): string {
  return `${v.txid ?? "?"}:${v.vout ?? "?"}`;
}

/** Mirror SDK selectVirtualCoins ordering (earlier expiry, then larger value). */
function sortSpendableLikeSdk(coins: SpendableVtxo[]): SpendableVtxo[] {
  return [...coins].sort((a, b) => {
    const expiryA = vtxoBatchExpiry(a);
    const expiryB = vtxoBatchExpiry(b);
    if (expiryA !== expiryB) return expiryA - expiryB;
    return b.value - a.value;
  });
}

async function readMinVtxoSats(w: {
  arkProvider?: { getInfo?: () => Promise<{ dust?: bigint | number | string }> };
  dustAmount?: bigint | number;
}): Promise<number> {
  const fromWallet = w.dustAmount;
  if (fromWallet != null) {
    const n = Number(fromWallet);
    if (Number.isFinite(n) && n > 0) return n;
  }
  try {
    const info = await withTimeout(w.arkProvider?.getInfo?.() ?? Promise.reject(), 1_500, "getInfo");
    const n = Number(info?.dust);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* bundled default */
  }
  return DEFAULT_MIN_VTXO_SATS;
}

/**
 * ASP rejects change below min vtxo even when the SDK encodes it as subdust.
 * Prefer pulling extra inputs so change is 0 or >= dust; otherwise bump amount
 * to consume the selected set exactly (caller confirms the bump).
 */
async function prepareDustSafeSend(
  w: Pick<BasicWallet, "getSpendableVtxos">,
  amount: number,
  dust: number,
): Promise<DustSafeSendPlan> {
  if (typeof w.getSpendableVtxos !== "function") {
    return { amount, amountBumped: false, originalAmount: amount };
  }
  let list: SpendableVtxo[];
  try {
    list = await withTimeout(w.getSpendableVtxos(), 2_500, "getSpendableVtxos");
  } catch {
    return { amount, amountBumped: false, originalAmount: amount };
  }
  const coins = list.filter((v) => Number(v.value) > 0);
  if (coins.length === 0) {
    return { amount, amountBumped: false, originalAmount: amount };
  }

  const sorted = sortSpendableLikeSdk(coins);
  const selected: SpendableVtxo[] = [];
  let selectedSum = 0;
  for (const coin of sorted) {
    if (selectedSum >= amount) break;
    selected.push(coin);
    selectedSum += coin.value;
  }
  if (selectedSum < amount) {
    throw new Error("Insufficient funds");
  }

  const unused = sorted.filter((c) => !selected.some((s) => vtxoKey(s) === vtxoKey(c)));
  let change = selectedSum - amount;
  for (const coin of unused) {
    if (!(change > 0 && change < dust)) break;
    selected.push(coin);
    selectedSum += coin.value;
    change = selectedSum - amount;
  }

  if (change > 0 && change < dust) {
    // No more inputs: send the whole selection (change = 0).
    return {
      amount: selectedSum,
      selectedVtxos: selected,
      amountBumped: true,
      originalAmount: amount,
    };
  }

  // Pin the selection so SDK cannot re-pick into dust change.
  return {
    amount,
    selectedVtxos: selected,
    amountBumped: false,
    originalAmount: amount,
  };
}

function formatSendError(e: unknown, dust = DEFAULT_MIN_VTXO_SATS): string {
  const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
  if (
    /AMOUNT_TOO_LOW/i.test(msg) ||
    /min vtxo amount/i.test(msg) ||
    /DustChangeError/i.test(msg) ||
    /below dust/i.test(msg)
  ) {
    return (
      `This amount would leave change below the network minimum (${dust} sats). ` +
      `Try a slightly different amount, or send enough to spend a whole coin.`
    );
  }
  return msg;
}

function confirmAmountBump(original: number, bumped: number, dust: number): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Adjust amount?",
      `Sending ${original} sats would leave change below the network minimum (${dust} sats). ` +
        `Send ${bumped} sats instead (no change)?`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: `Send ${bumped}`, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Resolve as soon as SDK send returns *or* local spendable drops by ~amount
 * (receiver often sees the payment before send()'s DB bookkeeping finishes).
 * Poll stops when `isDone` is true — no leaked timers after success/fail.
 */
async function waitForSendOrSpendDrop(
  w: BasicWallet,
  opts: {
    address: string;
    amount: number;
    selectedVtxos?: SpendableVtxo[];
    prevAvailable: number | null;
    timeoutMs: number;
    onRealTxid?: (txid: string) => void;
  },
): Promise<{ txid: string; via: "send" | "spend" }> {
  let settled = false;
  let resolveEarly!: (v: { txid: string; via: "send" | "spend" }) => void;
  let rejectEarly!: (e: unknown) => void;
  const early = new Promise<{ txid: string; via: "send" | "spend" }>((resolve, reject) => {
    resolveEarly = resolve;
    rejectEarly = reject;
  });

  const finish = (v: { txid: string; via: "send" | "spend" }) => {
    if (settled) return;
    settled = true;
    resolveEarly(v);
  };

  const sendP = (
    opts.selectedVtxos && opts.selectedVtxos.length > 0
      ? w.send({
          recipients: [{ address: opts.address, amount: opts.amount }],
          selectedVtxos: opts.selectedVtxos,
        })
      : w.send({
          recipients: [{ address: opts.address, amount: opts.amount }],
        })
  ).then((raw) => {
    const txid = extractSendTxid(raw);
    finish({ txid, via: "send" });
    return txid;
  });

  void sendP
    .then((txid) => {
      if (txid) opts.onRealTxid?.(txid);
    })
    .catch(() => {
      /* rejection handled below */
    });

  void sendP.catch((e) => {
    if (!settled) {
      settled = true;
      rejectEarly(e);
    } else {
      console.warn("[basic] send completed with error after UI success", e);
    }
  });

  void (async () => {
    try {
      if (opts.prevAvailable == null || !(opts.prevAvailable > 0)) return;
      const target = opts.prevAvailable - opts.amount;
      const deadline = Date.now() + opts.timeoutMs;
      let hits = 0;
      while (!settled && Date.now() < deadline) {
        await sleep(SPEND_POLL_MS);
        if (settled) return;
        const avail = await readSpendableAvailable(w);
        if (avail == null) continue;
        // Require two samples so a single flaky read cannot false-complete.
        if (avail <= target + 1) hits += 1;
        else hits = 0;
        if (hits < 2) continue;
        console.warn("[basic] send spend-drop detected", {
          prev: opts.prevAvailable,
          avail,
          amount: opts.amount,
        });
        const txid = await Promise.race([
          sendP.catch(() => null),
          sleep(TXID_GRACE_MS).then(() => `pending:${Date.now()}`),
        ]);
        if (txid == null) return;
        finish({ txid, via: "spend" });
        return;
      }
    } catch (e) {
      console.warn("[basic] spend-drop watcher error", e);
    }
  })();

  return withTimeout(early, opts.timeoutMs, "send");
}

export function SendScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Send">>();
  const { openFundsSent } = useSheets();
  const {
    wallet,
    balance,
    balanceHidden,
    toggleBalanceHidden,
    refresh,
    balanceStatus,
    walletInteractive,
    beginOutboundSend,
    endOutboundSend,
    applyLocalSpend,
    selectedWallet,
    wallets,
    bumpActivity,
  } = useWallet();
  const network = getNetworkConfig();
  const [address, setAddress] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [myWalletPeekId, setMyWalletPeekId] = useState<string | null>(null);
  const [myWalletDestLabel, setMyWalletDestLabel] = useState<string | null>(null);
  const [enterSheetOpen, setEnterSheetOpen] = useState(false);
  const [myWalletsSheetOpen, setMyWalletsSheetOpen] = useState(false);
  const [enterDraft, setEnterDraft] = useState("");
  const enterInputRef = useRef<TextInputType>(null);
  const isLightning = selectedWallet?.kind === "lightning";
  const sendBlocked = !walletInteractive || balanceStatus === "loading";

  const myArkadeWallets = useMemo(() => {
    if (isLightning || !selectedWallet) return [] as WalletRecord[];
    return wallets.filter(
      (w) => w.kind === "arkade" && w.id !== selectedWallet.id,
    );
  }, [isLightning, selectedWallet, wallets]);

  const showMyWalletsAction = myArkadeWallets.length > 0;

  // Focus Enter field only after the sheet is open — never on Send mount
  // (hidden TextInput + autoFocus was stealing the keyboard).
  useEffect(() => {
    if (!enterSheetOpen) {
      enterInputRef.current?.blur();
      return;
    }
    const t = setTimeout(() => enterInputRef.current?.focus(), 280);
    return () => clearTimeout(t);
  }, [enterSheetOpen]);

  useEffect(() => {
    const to = route.params?.to?.trim();
    const amt = route.params?.amountSats;
    if (to) {
      const prefer = isLightning ? "lightning" : "arkade";
      const intent = resolvePayIntent(to, prefer);
      setAddress(intent?.destination ?? to);
      setMyWalletDestLabel(null);
      if (intent?.amountSats != null) {
        setAmountStr(String(intent.amountSats));
      } else if (amt != null && amt > 0) {
        setAmountStr(String(Math.floor(amt)));
      }
    } else if (amt != null && amt > 0) {
      setAmountStr(String(Math.floor(amt)));
    }
  }, [route.params?.to, route.params?.amountSats, isLightning]);

  const [lnRole, setLnRole] = useState<"admin" | "invoice" | null>(null);
  const [lnProbe, setLnProbe] = useState<LnPayProbe | null>(null);
  const [lnProbeBusy, setLnProbeBusy] = useState(false);
  const [lnProbeError, setLnProbeError] = useState<string | null>(null);

  const spendable = balance?.available ?? null;
  const bal = formatSatsLabel(spendable, balanceHidden);

  useEffect(() => {
    if (!isLightning || !selectedWallet?.id) {
      setLnRole(null);
      return;
    }
    const wid = selectedWallet.id;
    void loadLndHubCredentials(wid).then((hub) => {
      setLnRole(hub?.role ?? null);
    });
  }, [isLightning, selectedWallet?.id]);

  useEffect(() => {
    if (!isLightning) {
      setLnProbe(null);
      setLnProbeError(null);
      return;
    }
    const raw = address.trim();
    if (!raw || !looksLikeLightningPayInput(raw)) {
      setLnProbe(null);
      setLnProbeError(null);
      return;
    }
    // New destination — keep amount when BIP21 / route already set it;
    // fixed bolt11 amounts ignore amountStr anyway.
    let cancelled = false;
    setLnProbeBusy(true);
    setLnProbeError(null);
    void (async () => {
      try {
        const probe = await probeLightningPay(raw);
        if (!cancelled) setLnProbe(probe);
      } catch (e) {
        if (!cancelled) {
          setLnProbe(null);
          setLnProbeError(e instanceof Error ? e.message : "Unrecognized destination");
        }
      } finally {
        if (!cancelled) setLnProbeBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLightning, address]);

  function applyDestinationInput(text: string) {
    setMyWalletDestLabel(null);
    const prefer = isLightning ? "lightning" : "arkade";
    const intent = resolvePayIntent(text, prefer);
    if (intent && (text.includes("?") || /^bitcoin:/i.test(text.trim()))) {
      setAddress(intent.destination);
      if (intent.amountSats != null) setAmountStr(String(intent.amountSats));
      return;
    }
    setAddress(text);
  }

  function applyScannedPay(value: string, raw?: string) {
    setMyWalletDestLabel(null);
    const prefer = isLightning ? "lightning" : "arkade";
    const intent = resolvePayIntent(raw ?? value, prefer);
    setAddress(intent?.destination ?? value);
    if (intent?.amountSats != null) setAmountStr(String(intent.amountSats));
    setScanOpen(false);
  }

  async function pickMyWallet(dest: WalletRecord) {
    if (myWalletPeekId) return;
    setMyWalletPeekId(dest.id);
    try {
      const cached = await readCachedArkAddress(network.id, dest.id);
      if (cached?.arkAddress && isValidArkAddress(cached.arkAddress)) {
        setAddress(cached.arkAddress);
        setMyWalletDestLabel(dest.label);
        setMyWalletsSheetOpen(false);
        return;
      }
      const addr = await peekArkAddress(dest.id);
      if (!isValidArkAddress(addr)) {
        throw new Error("Invalid address from wallet");
      }
      await writeCachedArkAddress(network.id, dest.id, addr);
      setAddress(addr);
      setMyWalletDestLabel(dest.label);
      setMyWalletsSheetOpen(false);
    } catch (e) {
      console.warn("[basic] my-wallet destination failed", e);
      Alert.alert(
        "Address unavailable",
        `Open “${dest.label}” once from Wallets to enable transfers.`,
      );
    } finally {
      setMyWalletPeekId(null);
    }
  }

  function openEnterSheet() {
    Keyboard.dismiss();
    setEnterDraft(address);
    setEnterSheetOpen(true);
  }

  function closeEnterSheet() {
    enterInputRef.current?.blur();
    Keyboard.dismiss();
    setEnterSheetOpen(false);
  }

  function confirmEnterDestination() {
    applyDestinationInput(enterDraft);
    closeEnterSheet();
  }

  async function pasteDestination() {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) {
        Alert.alert("Clipboard empty", "Copy an ark address first.");
        return;
      }
      applyDestinationInput(text);
    } catch (e) {
      console.warn("[basic] clipboard paste failed", e);
      Alert.alert("Paste failed", "Could not read the clipboard.");
    }
  }

  function clearDestination() {
    setAddress("");
    setMyWalletDestLabel(null);
  }

  function fillMaxSend() {
    if (spendable == null || spendable <= 0) return;
    let max = Math.floor(spendable);
    if (isLightning && lnProbe?.maxSats != null && lnProbe.maxSats > 0) {
      max = Math.min(max, Math.floor(lnProbe.maxSats));
    }
    if (max <= 0) return;
    setAmountStr(String(max));
  }

  async function onSendLightning() {
    const raw = address.trim();
    if (!looksLikeLightningPayInput(raw)) {
      Alert.alert(
        "Invalid destination",
        "Paste or scan a BOLT11 invoice, LNURL, Lightning Address, or BIP353 address.",
      );
      return;
    }
    if (lnRole === "invoice") {
      Alert.alert(
        "Admin key required",
        "This connection is invoice-only. Reconnect with an admin LNDHub URL to send.",
      );
      return;
    }
    const walletId = selectedWallet?.id;
    if (!walletId) {
      Alert.alert("No Lightning wallet", "Connect a node first.");
      return;
    }
    const manual = Number.parseInt(amountStr.replace(/[,\s]/g, ""), 10);
    const manualAmt =
      Number.isFinite(manual) && manual > 0 ? manual : null;
    const payHint =
      lnProbe?.amountSats != null && lnProbe.amountSats > 0
        ? lnProbe.amountSats
        : manualAmt;
    if (lnProbe?.needsAmount && payHint == null) {
      Alert.alert(
        "Amount required",
        lnProbe.minSats != null && lnProbe.maxSats != null
          ? `Enter between ${lnProbe.minSats.toLocaleString("en-US")} and ${lnProbe.maxSats.toLocaleString("en-US")} sats.`
          : "Enter how many sats to send.",
      );
      return;
    }
    if (payHint != null && spendable !== null && payHint > spendable) {
      Alert.alert("Insufficient balance", `Available: ${bal}`);
      return;
    }

    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm Lightning send");
      if (!auth.ok) {
        Alert.alert("Authentication required", auth.reason);
        return;
      }
      beginOutboundSend();
      try {
        const hub = await loadLndHubCredentials(walletId);
        if (!hub) {
          throw new Error("LNDHub not connected for this wallet");
        }

        const resolved = await resolveLightningPay(raw, payHint, lnProbe ?? undefined);
        if (spendable !== null && resolved.amountSats > spendable) {
          Alert.alert("Insufficient balance", `Available: ${bal}`);
          return;
        }

        notePendingSendFromThisDevice(network.id, walletId, resolved.amountSats, resolved.display);
        const invoiceAmt = parseBolt11AmountSats(resolved.bolt11);
        const result = await withTimeout(
          lndhubPayInvoice(hub, resolved.bolt11, {
            amountSats: invoiceAmt == null ? resolved.amountSats : undefined,
          }),
          LN_SEND_TIMEOUT_MS,
          "lndhubPayInvoice",
        );
        const paymentHash = result.paymentHash.toLowerCase();
        const activityId = `ln-out-${paymentHash}`;
        upsertLightningPayments(network.id, walletId, [
          {
            id: activityId,
            amountSats: resolved.amountSats,
            direction: "out",
            createdAt: Date.now(),
            settled: true,
            memo: resolved.description ?? lnProbe?.description,
            paymentHash,
            preimage: result.preimage,
            feeSats: result.feeSats,
          },
        ]);
        recordSentFromThisDevice(network.id, walletId, activityId);
        bumpActivity();
        applyLocalSpend(resolved.amountSats + (result.feeSats ?? 0));
        setAddress("");
        setAmountStr("");
        setLnProbe(null);
        setBusy(false);
        // Overlay first (covers Send). Done/back navigates Home — no Home flash.
        openFundsSent({
          amount: resolved.amountSats,
          txid: paymentHash,
          address: resolved.display,
          rail: "lightning",
        });
        void refresh().catch((e) => console.warn("[basic] post-ln-send refresh failed", e));
      } finally {
        endOutboundSend();
      }
    } catch (e) {
      Alert.alert("Send failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    if (isLightning) {
      await onSendLightning();
      return;
    }

    const trimmed = address.trim();
    const amount = Number.parseInt(amountStr.replace(/[,\s]/g, ""), 10);

    if (!wallet) {
      Alert.alert("Wallet closed", "Re-open the wallet and try again.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Invalid amount", "Enter a positive amount in sats.");
      return;
    }
    if (spendable !== null && amount > spendable) {
      Alert.alert("Insufficient balance", `Available: ${bal}`);
      return;
    }
    if (isBtcAddress(trimmed)) {
      Alert.alert(
        "On-chain not on soft path",
        "Direct bc1… sends are reserved for Lightning corridor, multisig, or hardware. Use an ark… address for L2.",
      );
      return;
    }
    if (!isValidArkAddress(trimmed)) {
      Alert.alert("Invalid address", "Paste a valid Arkade (ark…) address.");
      return;
    }

    setBusy(true);
    let dust = DEFAULT_MIN_VTXO_SATS;
    try {
      dust = await readMinVtxoSats(wallet);
      if (amount < dust) {
        Alert.alert(
          "Amount too low",
          `Minimum send on this network is ${dust} sats (ASP dust / min vtxo).`,
        );
        return;
      }

      const plan = await prepareDustSafeSend(wallet, amount, dust);
      let sendAmount = plan.amount;
      if (plan.amountBumped) {
        const ok = await confirmAmountBump(plan.originalAmount, plan.amount, dust);
        if (!ok) return;
        setAmountStr(String(plan.amount));
        sendAmount = plan.amount;
      }

      const auth = await requireUserPresence("Confirm send");
      if (!auth.ok) {
        Alert.alert("Authentication required", auth.reason);
        return;
      }

      beginOutboundSend();
      try {
        notePendingSendFromThisDevice(network.id, selectedWallet?.id ?? "", sendAmount, trimmed);
        const prevAvailable = balance?.available ?? null;
        const walletId = selectedWallet?.id;
        const { txid, via } = await waitForSendOrSpendDrop(wallet, {
          address: trimmed,
          amount: sendAmount,
          selectedVtxos: plan.selectedVtxos,
          prevAvailable,
          timeoutMs: SEND_TIMEOUT_MS,
          onRealTxid: (real) => {
            if (!walletId || !real || real.startsWith("pending:")) return;
            recordSentFromThisDevice(network.id, walletId, real);
          },
        });
        console.warn("[basic] send settled", { via, txid: txid.slice(0, 16) });
        if (walletId && txid) {
          // Stamp under raw txid; Activity detail also resolves via related tx keys.
          recordSentFromThisDevice(network.id, walletId, txid);
        }

        // Optimistic Home balance — live getBalance often lags / times out after send.
        applyLocalSpend(sendAmount);

        // Row in activity_idx now so View details / Activity work before SDK history.
        let activityIdForNotice = txid;
        if (walletId) {
          try {
            const { recordOptimisticArkadeSend } = await import("../account/activityStore");
            activityIdForNotice = recordOptimisticArkadeSend(network.id, walletId, {
              amountSats: sendAmount,
              txid,
              address: trimmed,
            });
            bumpActivity();
          } catch (e) {
            console.warn("[basic] optimistic send activity failed", e);
          }
        }

        // Overlay first (covers Send). Done/back navigates Home — no Home flash.
        // Do not await refresh/materialize (getBalance often hangs after ASP settle).
        setAddress("");
        setAmountStr("");
        setBusy(false);
        openFundsSent({ amount: sendAmount, txid: activityIdForNotice, address: trimmed });

        void (async () => {
          try {
            await refresh();
            if (!walletId || !txid) return;
            const { readActivityFromDb } = await import("../account/activityStore");
            const rows = readActivityFromDb(network.id, {
              walletId,
              limit: 40,
            });
            const hit = rows.find(
              (r) =>
                r.id === txid ||
                r.id === activityIdForNotice ||
                r.txs.some(
                  (t) =>
                    t.arkTxid === txid ||
                    t.boardingTxid === txid ||
                    t.commitmentTxid === txid,
                ),
            );
            if (hit && hit.id !== txid) {
              recordSentFromThisDevice(network.id, walletId, hit.id);
            }
            bumpActivity();
          } catch (e) {
            console.warn("[basic] post-send refresh failed", e);
          }
        })();
      } finally {
        endOutboundSend();
      }
    } catch (e) {
      Alert.alert("Send failed", formatSendError(e, dust));
    } finally {
      setBusy(false);
    }
  }

  if (isLightning) {
    const previewAmt = lnProbe?.amountSats;
    const canSend =
      !sendBlocked &&
      lnRole !== "invoice" &&
      !!lnProbe &&
      lnProbe.kind !== "bolt12" &&
      !lnProbeBusy;
    const kindLabel =
      lnProbe?.kind === "lightning-address"
        ? "Lightning Address"
        : lnProbe?.kind === "bip353"
          ? "BIP353"
          : lnProbe?.kind === "lnurl"
            ? "LNURL"
            : lnProbe?.kind === "bolt12"
              ? "BOLT12"
              : "BOLT11";

    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={styles.title}>SEND</Text>
        <Pressable onPress={toggleBalanceHidden}>
          <Text style={styles.balance}>{bal}</Text>
        </Pressable>
        <Text style={styles.caption}>
          Lightning · invoice / LNURL / address · {selectedWallet?.label ?? "node"}
        </Text>

        {sendBlocked ? (
          <Text style={styles.warn}>
            Wallet still syncing — sending unavailable until ready.
          </Text>
        ) : null}

        {lnRole === "invoice" ? (
          <Text style={styles.warn}>
            Invoice-only key: receive works, send needs an admin LNDHub connection URL.
          </Text>
        ) : null}

        <View style={styles.toRow}>
          <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
            To (invoice / LNURL / address)
          </Text>
          {address.trim() ? (
            <Pressable onPress={() => setScanOpen(true)} hitSlop={8}>
              <Text style={styles.scanLink}>Scan QR</Text>
            </Pressable>
          ) : null}
        </View>
        <TextInput
          value={address}
          onChangeText={applyDestinationInput}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="lnbc… · user@domain · lnurl…"
          placeholderTextColor={colors.hint}
          multiline
          style={[styles.input, styles.inputMulti]}
        />

        {lnProbeBusy ? (
          <ActivityIndicator color={colors.fg} style={{ marginBottom: 12 }} />
        ) : lnProbeError ? (
          <Text style={[styles.warn, { marginBottom: 12 }]}>{lnProbeError}</Text>
        ) : lnProbe ? (
          <View style={styles.preview}>
            <Text style={styles.previewMemo}>{kindLabel}</Text>
            {previewAmt != null ? (
              <Text style={[styles.previewLine, { marginTop: 6 }]}>
                {previewAmt.toLocaleString("en-US")} sats
              </Text>
            ) : (
              <>
                <Text style={[styles.previewMemo, { marginTop: 8 }]}>
                  {lnProbe.kind === "bolt12"
                    ? "BOLT12 offer — not payable via this LNDHub node"
                    : lnProbe.minSats != null && lnProbe.maxSats != null
                      ? `Enter ${lnProbe.minSats.toLocaleString("en-US")}–${lnProbe.maxSats.toLocaleString("en-US")} sats`
                      : "Enter how many sats to send"}
                </Text>
                {lnProbe.kind !== "bolt12" ? (
                  <>
                    <View style={[styles.toRow, { marginTop: 12 }]}>
                      <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
                        Amount (sats)
                      </Text>
                      <Pressable
                        onPress={fillMaxSend}
                        disabled={spendable == null || spendable <= 0}
                        hitSlop={8}
                        accessibilityLabel="Max send"
                      >
                        <Text
                          style={[
                            styles.maxLink,
                            (spendable == null || spendable <= 0) && styles.maxLinkDisabled,
                          ]}
                        >
                          Max send
                        </Text>
                      </Pressable>
                    </View>
                    <TextInput
                      value={amountStr}
                      onChangeText={setAmountStr}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.hint}
                      style={[styles.input, { marginBottom: 0 }]}
                    />
                  </>
                ) : null}
              </>
            )}
            {lnProbe.description ? (
              <Text style={[styles.previewMemo, { marginTop: 10 }]} numberOfLines={2}>
                {lnProbe.description}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Pressable
          style={[styles.primary, (busy || !canSend) && { opacity: 0.6 }]}
          disabled={busy || !canSend}
          onPress={() => void onSend()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryText}>Confirm send</Text>
          )}
        </Pressable>

        {!address.trim() ? (
          <View style={styles.scanWrap}>
            <Pressable
              style={styles.scanFab}
              onPress={() => setScanOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Scan QR"
            >
              <View style={styles.scanRing}>
                <IconQr size={30} />
              </View>
              <Text style={styles.scanLabel}>scan QR</Text>
            </Pressable>
          </View>
        ) : null}

        <ScanQrModal
          visible={scanOpen}
          onClose={() => setScanOpen(false)}
          title="SCAN"
          idleHint="Point at the QR code to pay"
          rejectHint="Not a Lightning invoice / LNURL / address"
          parse={extractLightningPayFromScan}
          onScan={applyScannedPay}
        />
      </ScreenChrome>
    );
  }

  return (
    <View style={styles.screenRoot}>
      <ScreenChrome logoScale={0.77}>
        <Text style={styles.title}>SEND</Text>
        <Pressable onPress={toggleBalanceHidden}>
          <Text style={styles.balance}>{bal}</Text>
        </Pressable>
        <Text style={styles.caption}>Arkade → ark… · {network.label}</Text>

        {sendBlocked ? (
          <Text style={styles.warn}>
            Wallet still syncing — sending unavailable until ready.
          </Text>
        ) : null}

        <View style={styles.toRow}>
          <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>Amount (sats)</Text>
          <Pressable
            onPress={fillMaxSend}
            disabled={spendable == null || spendable <= 0}
            hitSlop={8}
            accessibilityLabel="Max send"
          >
            <Text
              style={[
                styles.maxLink,
                (spendable == null || spendable <= 0) && styles.maxLinkDisabled,
              ]}
            >
              Max send
            </Text>
          </Pressable>
        </View>
        <TextInput
          value={amountStr}
          onChangeText={setAmountStr}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={colors.hint}
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>To:</Text>
        {address.trim() ? (
          <View style={styles.destPreview}>
            <View style={styles.destPreviewTextWrap}>
              {myWalletDestLabel ? (
                <Text style={styles.destPreviewLabel} numberOfLines={1}>
                  My wallet · {myWalletDestLabel}
                </Text>
              ) : null}
              <Text style={styles.destPreviewAddr} numberOfLines={2}>
                {truncateDest(address.trim(), 14, 10)}
              </Text>
            </View>
            <Pressable onPress={clearDestination} hitSlop={8} accessibilityLabel="Clear destination">
              <Text style={styles.scanLink}>Clear</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.toActions}>
          <Pressable
            style={styles.toAction}
            onPress={openEnterSheet}
            accessibilityRole="button"
            accessibilityLabel="Enter destination"
          >
            <View style={styles.toActionIcon}>
              <IconEnter />
            </View>
            <Text style={styles.toActionLabel}>Enter</Text>
          </Pressable>
          <Pressable
            style={styles.toAction}
            onPress={() => void pasteDestination()}
            accessibilityRole="button"
            accessibilityLabel="Paste destination"
          >
            <View style={styles.toActionIcon}>
              <IconPaste />
            </View>
            <Text style={styles.toActionLabel}>Paste</Text>
          </Pressable>
          {showMyWalletsAction ? (
            <Pressable
              style={styles.toAction}
              onPress={() => setMyWalletsSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="My wallets"
            >
              <View style={styles.toActionIcon}>
                <IconMyWallets />
              </View>
              <Text style={styles.toActionLabel}>My wallets</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          style={[styles.primary, (busy || sendBlocked || !!myWalletPeekId) && { opacity: 0.6 }]}
          disabled={busy || sendBlocked || !!myWalletPeekId}
          onPress={() => void onSend()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryText}>Confirm send</Text>
          )}
        </Pressable>

        {/* Penpot 03 / 03f: large bottom-center scan when recipient empty */}
        {!address.trim() ? (
          <View style={styles.scanWrap}>
            <Pressable
              style={styles.scanFab}
              onPress={() => setScanOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Scan QR"
            >
              <View style={styles.scanRing}>
                <IconQr size={30} />
              </View>
              <Text style={styles.scanLabel}>scan QR</Text>
            </Pressable>
          </View>
        ) : null}

        <ScanQrModal
          visible={scanOpen}
          onClose={() => setScanOpen(false)}
          parse={extractArkAddressFromScan}
          onScan={applyScannedPay}
        />
      </ScreenChrome>

      <InteractiveBottomSheet
        open={enterSheetOpen}
        onDismiss={closeEnterSheet}
        visibleFraction={0.5}
        avoidKeyboard
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetTitle}>ENTER</Text>
          <Text style={styles.sheetCaption}>
            Ark address now. Handles (Lightning Address, BIP353, Nostr) later.
          </Text>
          <TextInput
            ref={enterInputRef}
            value={enterDraft}
            onChangeText={setEnterDraft}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="ark1…"
            placeholderTextColor={colors.hint}
            multiline
            style={[styles.input, styles.inputMulti, { marginBottom: 12 }]}
          />
          <Pressable
            style={[styles.primary, { marginTop: 0 }, !enterDraft.trim() && { opacity: 0.5 }]}
            disabled={!enterDraft.trim()}
            onPress={confirmEnterDestination}
          >
            <Text style={styles.primaryText}>Use destination</Text>
          </Pressable>
          {/* Future: contacts / search scroll here without growing the sheet. */}
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          />
        </View>
      </InteractiveBottomSheet>

      <InteractiveBottomSheet
        open={myWalletsSheetOpen}
        onDismiss={() => setMyWalletsSheetOpen(false)}
        visibleFraction={0.5}
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetTitle}>MY WALLETS</Text>
          <Text style={styles.sheetCaption}>Send to another wallet on this device</Text>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {myArkadeWallets.map((w) => {
              const peeking = myWalletPeekId === w.id;
              const selected = myWalletDestLabel === w.label && !!address.trim();
              return (
                <Pressable
                  key={w.id}
                  style={[styles.myWalletRow, selected && styles.myWalletRowSelected]}
                  disabled={!!myWalletPeekId}
                  onPress={() => void pickMyWallet(w)}
                  accessibilityRole="button"
                  accessibilityLabel={`Send to ${w.label}`}
                >
                  <Text style={styles.myWalletLabel} numberOfLines={1}>
                    {w.label}
                  </Text>
                  {peeking ? (
                    <ActivityIndicator color={colors.fg} size="small" />
                  ) : (
                    <Text style={styles.myWalletAction}>Use</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </InteractiveBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 8,
  },
  balance: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 28,
    color: colors.fg,
    textAlign: "center",
    marginTop: 12,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 28,
  },
  warn: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: "#E0A070",
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 8,
    lineHeight: 18,
  },
  toRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  fieldLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginBottom: 6,
  },
  scanLink: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.fg,
  },
  maxLink: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.fg,
  },
  maxLinkDisabled: {
    color: colors.hint,
    opacity: 0.5,
  },
  input: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  inputMulti: {
    fontSize: 13,
    minHeight: 88,
    textAlignVertical: "top",
  },
  destPreview: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    gap: 12,
  },
  destPreviewTextWrap: {
    flex: 1,
  },
  destPreviewLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 4,
  },
  destPreviewAddr: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
  toActions: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-around",
    marginBottom: 20,
    marginTop: 4,
  },
  toAction: {
    flex: 1,
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  toActionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  toActionLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
  },
  sheetBody: {
    flex: 1,
    paddingTop: 4,
    paddingBottom: 8,
    minHeight: 0,
  },
  sheetTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 8,
  },
  sheetCaption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  sheetScroll: {
    flex: 1,
    minHeight: 0,
    marginTop: 8,
  },
  sheetScrollContent: {
    paddingBottom: 12,
    flexGrow: 1,
  },
  myWalletRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  myWalletRowSelected: {
    borderColor: colors.fg,
  },
  myWalletLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
    flex: 1,
    marginRight: 12,
  },
  myWalletAction: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  preview: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  previewLine: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
  },
  previewMemo: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginTop: 8,
  },
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000000",
  },
  scanWrap: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 28,
    minHeight: 120,
  },
  scanFab: {
    alignItems: "center",
    gap: 10,
  },
  scanRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.fg,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  scanLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
});
