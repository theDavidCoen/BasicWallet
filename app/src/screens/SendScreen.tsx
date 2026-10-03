import { useFocusEffect, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isBtcAddress, isValidArkAddress } from "@arkade-os/sdk";
import type { RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { InteractiveBottomSheet } from "../components/sheet/InteractiveBottomSheet";
import { ContactPickList } from "../components/contacts/ContactPickList";
import { SaveToContactsSheet } from "../components/contacts/SaveToContactsSheet";
import { filterContacts } from "../contacts/contactSearch";
import { listContacts } from "../contacts/contactStore";
import { resolveBip353ForContacts } from "../contacts/resolveBip353";
import { nip05PayableMessage, resolveNip05 } from "../contacts/resolveNip05";
import type { Contact, ContactIdentifier } from "../contacts/types";
import { kindPillLabel, midEllipsis as contactMidEllipsis } from "../contacts/types";
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
import { peekArkAddress } from "../wallet/hdWallet";
import {
  DEFAULT_MIN_VTXO_SATS,
  MAX_SEND_RECIPIENTS,
  formatSendError,
  mergeRecipientsByAddress,
  prepareDustSafeSend,
  readMinVtxoSats,
  readSpendableAvailable,
  waitForSendOrSpendDrop,
  withTimeout,
  type SendRecipient,
} from "../wallet/arkMultiSend";
import { useWallet } from "../wallet/WalletProvider";
import { formatSatsLabel } from "../wallet/formatSats";
import { ScanQrModal, extractLightningPayFromScan, extractArkAddressFromScan } from "./ScanQrModal";
import { useFiatMode } from "../fiat/FiatModeProvider";
import {
  depixAssetIdForNetwork,
  fiatStableForNetwork,
  formatBrlDisplay,
  parseBrlDisplay,
} from "../fiat/depixAssets";
import { resolvePayIntent } from "../wallet/bip21Pay";
import type { WalletRecord } from "../account/walletRegistry";

/** Hard cap — SDK send often hangs after ASP already settled the payment. */
const SEND_TIMEOUT_MS = 45_000;
/** LNDHub can hang after payment already settled. */
const LN_SEND_TIMEOUT_MS = 30_000;

type SendLine = {
  id: string;
  address: string;
  amountStr: string;
  walletLabel: string | null;
  /** When set, amountStr is DePix display units and send uses assets[]. */
  assetId?: string | null;
  assetAmountDisplay?: string | null;
};

function newSendLine(partial?: Partial<SendLine>): SendLine {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address: "",
    amountStr: "",
    walletLabel: null,
    ...partial,
  };
}

/** Sats are integers — strip grouping dots/spaces so "1.000" / "1 000" → 1000. */
function parseAmountSats(raw: string): number | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

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


function confirmAmountBump(
  originalTotal: number,
  bumpedTotal: number,
  dust: number,
  opts?: { lastOriginal: number; lastBumped: number },
): Promise<boolean> {
  return new Promise((resolve) => {
    const detail =
      opts != null
        ? `Bump last recipient ${opts.lastOriginal.toLocaleString("en-US")} → ${opts.lastBumped.toLocaleString("en-US")} sats?`
        : `Send ${bumpedTotal.toLocaleString("en-US")} sats instead (no change)?`;
    Alert.alert(
      "Adjust amount?",
      `Sending ${originalTotal.toLocaleString("en-US")} sats would leave change below the network minimum (${dust} sats). ` +
        detail,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: `Send ${bumpedTotal.toLocaleString("en-US")}`,
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function SendScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Send">>();
  const { openFundsSent } = useSheets();
  const insets = useSafeAreaInsets();
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
    refreshBalanceOnly,
  } = useWallet();
  const { fiatMode, convertDepixToSatsForPay, depixDisplay, applyLocalDepixSpend } = useFiatMode();
  const network = getNetworkConfig();
  const depixAssetId = depixAssetIdForNetwork(network.id);
  /** Lightning path still uses flat address/amount. */
  const [address, setAddress] = useState("");
  const [amountStr, setAmountStr] = useState("");
  /** Arkade multi-send lines (always ≥1). */
  const [lines, setLines] = useState<SendLine[]>(() => [newSendLine()]);
  /** Live lines for post-await rebuild — onSend closure must not use stale amounts (α79). */
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [activeLineId, setActiveLineId] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [myWalletPeekId, setMyWalletPeekId] = useState<string | null>(null);
  const [enterSheetOpen, setEnterSheetOpen] = useState(false);
  const [myWalletsSheetOpen, setMyWalletsSheetOpen] = useState(false);
  const [enterDraft, setEnterDraft] = useState("");
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addDraftAddress, setAddDraftAddress] = useState("");
  const [addDraftAmount, setAddDraftAmount] = useState("");
  const [addDraftLabel, setAddDraftLabel] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<"primary" | "add">("primary");
  const [contactQuery, setContactQuery] = useState("");
  const [contactList, setContactList] = useState<Contact[]>([]);
  const [idPickerContact, setIdPickerContact] = useState<Contact | null>(null);
  const [saveAfterEnterOpen, setSaveAfterEnterOpen] = useState(false);
  const [saveAfterEnterDest, setSaveAfterEnterDest] = useState("");
  const [contactResolveBusy, setContactResolveBusy] = useState(false);
  const enterInputRef = useRef<TextInputType>(null);
  const isLightning = selectedWallet?.kind === "lightning";
  const sendMode: "arkade" | "lightning" = isLightning ? "lightning" : "arkade";
  const sendBlocked = !walletInteractive || balanceStatus === "loading";

  const reloadContacts = useCallback(() => {
    setContactList(listContacts());
  }, []);

  const filteredContacts = useMemo(
    () => filterContacts(contactList, contactQuery),
    [contactList, contactQuery],
  );

  const myArkadeWallets = useMemo(() => {
    if (isLightning || !selectedWallet) return [] as WalletRecord[];
    return wallets.filter(
      (w) => w.kind === "arkade" && w.id !== selectedWallet.id,
    );
  }, [isLightning, selectedWallet, wallets]);

  const showMyWalletsAction = myArkadeWallets.length > 0;

  useEffect(() => {
    if (!activeLineId && lines[0]) setActiveLineId(lines[0].id);
  }, [activeLineId, lines]);

  const primaryLine = lines[0] ?? null;
  const arkTotal = useMemo(() => {
    let sum = 0;
    for (const l of lines) {
      const a = parseAmountSats(l.amountStr);
      if (a != null) sum += a;
    }
    return sum;
  }, [lines]);
  const canAddRecipient =
    !isLightning &&
    lines.length < MAX_SEND_RECIPIENTS &&
    !!primaryLine &&
    isValidArkAddress(primaryLine.address.trim());
  const primaryHasDest = !!primaryLine?.address.trim();

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
      const dest = intent?.destination ?? to;
      const amtStr =
        intent?.amountSats != null
          ? String(intent.amountSats)
          : amt != null && amt > 0
            ? String(Math.floor(amt))
            : "";
      if (isLightning) {
        setAddress(dest);
        if (amtStr) setAmountStr(amtStr);
      } else {
        const line = newSendLine({
          address: dest,
          amountStr: amtStr,
          walletLabel: null,
        });
        setLines([line]);
        setActiveLineId(line.id);
      }
    } else if (amt != null && amt > 0) {
      if (isLightning) {
        setAmountStr(String(Math.floor(amt)));
      } else {
        setLines((prev) => {
          const first = prev[0] ?? newSendLine();
          return [{ ...first, amountStr: String(Math.floor(amt)) }, ...prev.slice(1)];
        });
      }
    }
  }, [route.params?.to, route.params?.amountSats, isLightning]);

  const [lnRole, setLnRole] = useState<"admin" | "invoice" | null>(null);
  const [lnProbe, setLnProbe] = useState<LnPayProbe | null>(null);
  const [lnProbeBusy, setLnProbeBusy] = useState(false);
  const [lnProbeError, setLnProbeError] = useState<string | null>(null);

  const spendable = balance?.available ?? null;
  const fiatUnit = fiatStableForNetwork(network.id).displayCode;
  const bal = fiatMode
    ? formatBrlDisplay(depixDisplay ?? 0, { hidden: balanceHidden, networkId: network.id })
    : formatSatsLabel(spendable, balanceHidden);

  // Fiat Mode: amount fields are BRL; stamp DePix asset id on lines.
  // Classic sats: never keep a stale assetId (Send often stays mounted in the stack).
  useEffect(() => {
    if (isLightning) return;
    if (fiatMode) {
      setLines((prev) => {
        let changed = false;
        const next = prev.map((l) => {
          if (l.assetId) return l;
          changed = true;
          return { ...l, assetId: depixAssetId };
        });
        return changed ? next : prev;
      });
      return;
    }
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (!l.assetId) return l;
        changed = true;
        return { ...l, assetId: null };
      });
      return changed ? next : prev;
    });
  }, [fiatMode, isLightning, depixAssetId]);

  // Every time Send is focused outside Fiat Mode, scrub leftover asset legs.
  useFocusEffect(
    useCallback(() => {
      if (isLightning || fiatMode) return;
      setLines((prev) => {
        let changed = false;
        const next = prev.map((l) => {
          if (!l.assetId) return l;
          changed = true;
          return { ...l, assetId: null };
        });
        return changed ? next : prev;
      });
    }, [fiatMode, isLightning]),
  );

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

  function patchLine(id: string, patch: Partial<SendLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function applyDestinationToActive(text: string, walletLabel: string | null = null) {
    const prefer = isLightning ? "lightning" : "arkade";
    const intent = resolvePayIntent(text, prefer);
    const dest =
      intent && (text.includes("?") || /^bitcoin:/i.test(text.trim()))
        ? intent.destination
        : text;
    const amt =
      intent?.assetId && intent.assetAmountDisplay
        ? intent.assetAmountDisplay
        : intent &&
            (text.includes("?") || /^bitcoin:/i.test(text.trim())) &&
            intent.amountSats != null
          ? String(intent.amountSats)
          : null;
    const assetId =
      intent?.assetId ??
      (fiatMode && !isLightning ? depixAssetId : null);

    if (isLightning) {
      setAddress(dest);
      if (amt) setAmountStr(amt);
      return;
    }

    if (pickerTarget === "add") {
      setAddDraftAddress(dest);
      setAddDraftLabel(walletLabel);
      if (amt) setAddDraftAmount(amt);
      return;
    }

    const targetId = lines[0]?.id;
    if (!targetId) return;
    setLines((prev) =>
      prev.map((l) =>
        l.id === targetId
          ? {
              ...l,
              address: dest,
              walletLabel,
              ...(amt ? { amountStr: amt } : {}),
              assetId,
              assetAmountDisplay: intent?.assetAmountDisplay ?? null,
            }
          : l,
      ),
    );
    setActiveLineId(targetId);
  }

  function applyDestinationInput(text: string) {
    applyDestinationToActive(text, null);
  }

  function applyScannedPay(value: string, raw?: string) {
    const prefer = isLightning ? "lightning" : "arkade";
    const intent = resolvePayIntent(raw ?? value, prefer);
    applyDestinationToActive(intent?.destination ?? value, null);
    if (intent?.amountSats != null && isLightning) {
      setAmountStr(String(intent.amountSats));
    } else if (intent?.amountSats != null && !isLightning) {
      if (pickerTarget === "add") setAddDraftAmount(String(intent.amountSats));
      else if (lines[0]?.id) patchLine(lines[0].id, { amountStr: String(intent.amountSats) });
    }
    setScanOpen(false);
  }

  async function pickMyWallet(dest: WalletRecord) {
    if (myWalletPeekId) return;
    setMyWalletPeekId(dest.id);
    try {
      const cached = await readCachedArkAddress(network.id, dest.id);
      if (cached?.arkAddress && isValidArkAddress(cached.arkAddress)) {
        applyDestinationToActive(cached.arkAddress, dest.label);
        setMyWalletsSheetOpen(false);
        return;
      }
      const addr = await peekArkAddress(dest.id);
      if (!isValidArkAddress(addr)) {
        throw new Error("Invalid address from wallet");
      }
      await writeCachedArkAddress(network.id, dest.id, addr);
      applyDestinationToActive(addr, dest.label);
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


  function openEnterSheet(target: "primary" | "add" = "primary") {
    Keyboard.dismiss();
    setPickerTarget(target);
    setContactQuery("");
    reloadContacts();
    if (target === "add") {
      setEnterDraft(addDraftAddress);
    } else {
      const id = lines[0]?.id;
      if (id) setActiveLineId(id);
      setEnterDraft(isLightning ? address : (lines[0]?.address ?? ""));
    }
    setEnterSheetOpen(true);
  }

  function closeEnterSheet() {
    enterInputRef.current?.blur();
    Keyboard.dismiss();
    setEnterSheetOpen(false);
    setIdPickerContact(null);
  }

  function confirmEnterDestination() {
    const raw = enterDraft.trim();
    applyDestinationInput(enterDraft);
    closeEnterSheet();
    if (raw) {
      Alert.alert("Save to contacts?", contactMidEllipsis(raw, 16, 10), [
        { text: "Skip", style: "cancel" },
        {
          text: "Save",
          onPress: () => {
            setSaveAfterEnterDest(raw);
            setSaveAfterEnterOpen(true);
          },
        },
      ]);
    }
  }

  function identifierEligible(ident: ContactIdentifier): boolean {
    if (sendMode === "arkade") return ident.kind === "ark";
    return (
      ident.kind === "lightning_address" ||
      ident.kind === "bip353" ||
      ident.kind === "lnurl" ||
      ident.kind === "nip05"
    );
  }

  async function applyContactIdentifier(contact: Contact, ident: ContactIdentifier) {
    setContactResolveBusy(true);
    try {
      if (ident.kind === "nip05") {
        const r = await resolveNip05(ident.value);
        if (!r.ok) {
          Alert.alert("NIP-05", r.message);
          return;
        }
        if (r.lud16 && sendMode === "lightning") {
          applyDestinationToActive(r.lud16, contact.name);
          closeEnterSheet();
          return;
        }
        Alert.alert("NIP-05", nip05PayableMessage(sendMode));
        return;
      }
      if (ident.kind === "bip353") {
        const r = await resolveBip353ForContacts(ident.value, sendMode);
        if (!r.ok) {
          Alert.alert("BIP 353", r.message);
          return;
        }
        applyDestinationToActive(r.payDestination, contact.name);
        closeEnterSheet();
        return;
      }
      if (ident.kind === "npub" || ident.kind === "custom") {
        Alert.alert(
          "Not payable here",
          `${kindPillLabel(ident)} can’t be used as a Send destination on this wallet yet.`,
        );
        return;
      }
      if (ident.kind === "onchain" && sendMode === "arkade") {
        Alert.alert(
          "On-chain not on soft path",
          "This soft Arkade wallet can’t send on-chain. Use an ark… address.",
        );
        return;
      }
      if (sendMode === "arkade" && ident.kind !== "ark") {
        Alert.alert(
          "Wrong rail",
          `“${kindPillLabel(ident)}” isn’t an Ark destination. Switch wallet or pick another identifier.`,
        );
        return;
      }
      if (sendMode === "lightning") {
        const lnOk =
          ident.kind === "lightning_address" ||
          ident.kind === "lnurl" ||
          ident.kind === "ark"; // rare: allow paste-through if stored
        if (!lnOk) {
          Alert.alert(
            "Wrong rail",
            `“${kindPillLabel(ident)}” isn’t a Lightning destination for this wallet.`,
          );
          return;
        }
      }
      applyDestinationToActive(ident.value.trim(), contact.name);
      closeEnterSheet();
    } finally {
      setContactResolveBusy(false);
      setIdPickerContact(null);
    }
  }

  function onPickContact(contact: Contact) {
    const eligible = contact.identifiers.filter(identifierEligible);
    const all = contact.identifiers;
    if (all.length === 0) return;
    if (eligible.length === 1) {
      void applyContactIdentifier(contact, eligible[0]!);
      return;
    }
    if (eligible.length === 0 && all.length === 1) {
      void applyContactIdentifier(contact, all[0]!);
      return;
    }
    setIdPickerContact(contact);
  }

  async function pasteDestination(target: "primary" | "add" = "primary") {
    setPickerTarget(target);
    try {
      const clip = (await Clipboard.getStringAsync()).trim();
      if (!clip) {
        Alert.alert("Clipboard empty", "Copy an address first.");
        return;
      }
      applyDestinationToActive(clip, null);
      Alert.alert("Save to contacts?", contactMidEllipsis(clip, 16, 10), [
        { text: "Skip", style: "cancel" },
        {
          text: "Save",
          onPress: () => {
            setSaveAfterEnterDest(clip);
            setSaveAfterEnterOpen(true);
          },
        },
      ]);
    } catch (e) {
      console.warn("[basic] clipboard paste failed", e);
      Alert.alert("Paste failed", "Could not read the clipboard.");
    }
  }

  function clearPrimaryDestination() {
    const id = lines[0]?.id;
    if (!id) return;
    patchLine(id, { address: "", walletLabel: null });
  }

  function removeRecipientLine(lineId: string) {
    setLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((l) => l.id !== lineId);
    });
  }

  function openAddRecipientSheet() {
    if (!canAddRecipient) return;
    Keyboard.dismiss();
    setAddDraftAddress("");
    setAddDraftAmount("");
    setAddDraftLabel(null);
    setPickerTarget("add");
    setAddSheetOpen(true);
  }

  function closeAddRecipientSheet() {
    setAddSheetOpen(false);
    setPickerTarget("primary");
  }

  function confirmAddRecipient() {
    const addr = addDraftAddress.trim();
    if (!isValidArkAddress(addr)) {
      Alert.alert("Invalid address", "Paste a valid Arkade (ark…) address.");
      return;
    }
    if (fiatMode) {
      const brl = parseBrlDisplay(addDraftAmount);
      if (brl == null) {
        Alert.alert("Amount required", `Enter how many ${fiatUnit} for this recipient.`);
        return;
      }
      if (lines.length >= MAX_SEND_RECIPIENTS) {
        Alert.alert("Limit reached", `You can send to at most ${MAX_SEND_RECIPIENTS} recipients.`);
        return;
      }
      const line = newSendLine({
        address: addr,
        amountStr: String(brl),
        walletLabel: addDraftLabel,
        assetId: depixAssetId,
      });
      setLines((prev) => [...prev, line]);
      closeAddRecipientSheet();
      return;
    }
    const amt = parseAmountSats(addDraftAmount);
    if (amt == null) {
      Alert.alert("Amount required", "Enter how many sats for this recipient.");
      return;
    }
    if (lines.length >= MAX_SEND_RECIPIENTS) {
      Alert.alert("Limit reached", `You can send to at most ${MAX_SEND_RECIPIENTS} recipients.`);
      return;
    }
    const line = newSendLine({
      address: addr,
      amountStr: String(amt),
      walletLabel: addDraftLabel,
    });
    setLines((prev) => [...prev, line]);
    closeAddRecipientSheet();
  }

  function fillMaxSend(target: "primary" | "add" | string = "primary") {
    if (fiatMode && !isLightning) {
      const maxBrl = depixDisplay ?? 0;
      if (!(maxBrl > 0)) return;
      const formatted = maxBrl.toFixed(2);
      if (target === "add") {
        setAddDraftAmount(formatted);
        return;
      }
      const targetId = target === "primary" ? lines[0]?.id : target;
      if (!targetId) return;
      patchLine(targetId, { amountStr: formatted, assetId: depixAssetId });
      return;
    }
    if (spendable == null || spendable <= 0) return;
    if (isLightning) {
      let max = Math.floor(spendable);
      if (lnProbe?.maxSats != null && lnProbe.maxSats > 0) {
        max = Math.min(max, Math.floor(lnProbe.maxSats));
      }
      if (max <= 0) return;
      setAmountStr(String(max));
      return;
    }
    if (target === "add") {
      let others = 0;
      for (const l of lines) {
        const a = parseAmountSats(l.amountStr);
        if (a != null) others += a;
      }
      const max = Math.floor(spendable) - others;
      if (max <= 0) return;
      setAddDraftAmount(String(max));
      return;
    }
    const targetId = target === "primary" ? lines[0]?.id : target;
    if (!targetId) return;
    let others = 0;
    for (const l of lines) {
      if (l.id === targetId) continue;
      const a = parseAmountSats(l.amountStr);
      if (a != null) others += a;
    }
    const max = Math.floor(spendable) - others;
    if (max <= 0) return;
    patchLine(targetId, { amountStr: String(max) });
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

  async function buildRecipientsFromLines(
    source: SendLine[],
  ): Promise<
    | { ok: true; recipients: SendRecipient[]; wantsAsset: boolean }
    | { ok: false }
  > {
    const built: SendRecipient[] = [];
    for (const line of source) {
      const trimmed = line.address.trim();
      // Classic sats: ignore leftover assetId (Fiat Mode stamps it; stack may keep Send mounted).
      const assetIdForLine = fiatMode
        ? line.assetId ||
          (trimmed && !isBtcAddress(trimmed) && isValidArkAddress(trimmed)
            ? depixAssetId
            : null)
        : null;
      if (assetIdForLine) {
        const display = parseBrlDisplay(line.amountStr);
        if (!trimmed || display == null) {
          Alert.alert(
            "Incomplete recipient",
            "Each recipient needs an ark… address and a positive fiat amount.",
          );
          return { ok: false };
        }
        if (!isValidArkAddress(trimmed)) {
          Alert.alert("Invalid address", "Paste a valid Arkade (ark…) address.");
          return { ok: false };
        }
        const { depixDisplayToAtomic: toAtomic } = await import("../fiat/depixAssets");
        built.push({
          address: trimmed,
          // Official arkade.money sendAssets uses amount: 0 for pure asset transfers
          // (no carrier dust). Users in Fiat Mode may have zero sats.
          amount: 0,
          assets: [
            {
              assetId: assetIdForLine,
              amount: toAtomic(display, network.id),
            },
          ],
        });
        continue;
      }
      const amount = parseAmountSats(line.amountStr);
      if (!trimmed && amount == null) continue;
      if (!trimmed || amount == null) {
        Alert.alert(
          "Incomplete recipient",
          "Each recipient needs an ark… address and a positive amount.",
        );
        return { ok: false };
      }
      if (isBtcAddress(trimmed)) {
        Alert.alert(
          "On-chain not on soft path",
          "Direct bc1… sends are reserved for Lightning corridor, multisig, or hardware. Use an ark… address for L2.",
        );
        return { ok: false };
      }
      if (!isValidArkAddress(trimmed)) {
        Alert.alert("Invalid address", "Paste a valid Arkade (ark…) address.");
        return { ok: false };
      }
      built.push({ address: trimmed, amount: Math.floor(amount) });
    }

    if (built.length === 0) {
      Alert.alert("Nothing to send", "Add at least one recipient with an amount.");
      return { ok: false };
    }

    const recipients = mergeRecipientsByAddress(built);
    const wantsAsset = recipients.some((r) => (r.assets?.length ?? 0) > 0);
    return { ok: true, recipients, wantsAsset };
  }

  async function onSend() {
    if (isLightning) {
      await onSendLightning();
      return;
    }
    if (!wallet) {
      Alert.alert("Wallet closed", "Re-open the wallet and try again.");
      return;
    }

    // Lock UI before any await so amount edits cannot race validation (α79).
    setBusy(true);
    let dust = DEFAULT_MIN_VTXO_SATS;
    try {
      const first = await buildRecipientsFromLines(linesRef.current);
      if (!first.ok) return;

      let { recipients, wantsAsset } = first;
      if (fiatMode && !wantsAsset) {
        const need = recipients.reduce((s, r) => s + r.amount, 0);
        const have = spendable ?? 0;
        // Only convert when sats are short (targeted). Enough sats → fall through.
        if (need > have) {
          const brl = depixDisplay ?? 0;
          if (!(brl > 0)) {
            Alert.alert(
              `Insufficient ${fiatUnit}`,
              "Convert or receive the stable asset before sending sats.",
            );
            return;
          }
          Alert.alert(
            "Convert to sats",
            `This payment needs ${need.toLocaleString("en-US")} sats. Convert enough ${fiatUnit} (have ~${brl.toFixed(2)}) first? Fee applies.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Convert & send",
                onPress: () => {
                  void (async () => {
                    try {
                      await convertDepixToSatsForPay(need);
                      // Classic Send stays two-step: tap Send again after conversion.
                      Alert.alert("Converted", "Tap Send again to pay the sats invoice.");
                    } catch (e) {
                      Alert.alert(
                        "Conversion failed",
                        e instanceof Error ? e.message : "Unknown error",
                      );
                    }
                  })();
                },
              },
            ],
          );
          return;
        }
      }

      dust = Math.floor(Number(await readMinVtxoSats(wallet))) || DEFAULT_MIN_VTXO_SATS;
      // Rebuild from live linesRef after getInfo — never trust pre-await snapshot (α79).
      const rebuilt = await buildRecipientsFromLines(linesRef.current);
      if (!rebuilt.ok) return;
      recipients = rebuilt.recipients;
      wantsAsset = rebuilt.wantsAsset;

      let working = recipients.map((r) => ({
        ...r,
        amount: Math.floor(Number(r.amount)) || 0,
      }));
      for (const r of working) {
        // Asset-only recipients (amount 0 + assets) skip the sats dust floor —
        // matches arkade.money sendAssets / Network fees $0.00.
        if ((r.assets?.length ?? 0) > 0 && r.amount === 0) continue;
        if (r.amount < dust) {
          console.warn("[basic] Amount too low", {
            amount: r.amount,
            dust,
            addr: r.address.slice(0, 16),
            assets: r.assets?.length ?? 0,
            lines: linesRef.current.map((l) => ({
              amountStr: l.amountStr,
              assetId: l.assetId ? "y" : "n",
              addr: l.address.trim().slice(0, 12),
            })),
          });
          Alert.alert(
            "Amount too low",
            `Minimum per recipient on this network is ${dust} sats (ASP dust / min vtxo).`,
          );
          return;
        }
      }

      let paymentSum = working.reduce((s, r) => s + r.amount, 0);
      if (wantsAsset) {
        const needBrl = linesRef.current.reduce((s, l) => {
          const d = parseBrlDisplay(l.amountStr);
          return s + (d ?? 0);
        }, 0);
        const have = depixDisplay ?? 0;
        if (needBrl > have + 1e-8) {
          Alert.alert("Insufficient balance", `Available: ${bal}`);
          return;
        }
        // Partial asset sends need a second dust carrier for asset change.
        // Enter reserves DEFAULT_MIN_VTXO_SATS; if spendable is still too low,
        // ask to send the full balance instead of failing in the SDK.
        const partial = needBrl + 1e-8 < have;
        const availableSats = spendable ?? 0;
        if (partial && availableSats < DEFAULT_MIN_VTXO_SATS) {
          Alert.alert(
            "Not enough sats for change",
            `Sending part of your ${fiatUnit} needs about ${DEFAULT_MIN_VTXO_SATS} spare sats for the change output. Send the full balance, or receive a little more first.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: `Send all ${formatBrlDisplay(have, { networkId: network.id })}`,
                onPress: () => {
                  setLines((prev) => {
                    if (!prev[0]) return prev;
                    const copy = [...prev];
                    copy[0] = {
                      ...copy[0]!,
                      amountStr: have.toFixed(2).replace(".", ","),
                    };
                    return copy.slice(0, 1);
                  });
                },
              },
            ],
          );
          return;
        }
      } else if (spendable !== null && paymentSum > spendable) {
        Alert.alert("Insufficient balance", `Available: ${bal}`);
        return;
      }

      // Live vtxos win over inflated Home (α76 chat double-apply / stale Max).
      if (!wantsAsset && paymentSum > 0) {
        const liveSats = await readSpendableAvailable(wallet, { timeoutMs: 5_000 });
        if (liveSats != null && paymentSum > liveSats) {
          void refreshBalanceOnly();
          Alert.alert(
            "Insufficient balance",
            fiatMode
              ? `Available: ${liveSats.toLocaleString("en-US")} sats. In Fiat Mode, Home shows stable balance — convert more or wait for sats to settle.`
              : `Available: ${liveSats.toLocaleString("en-US")} sats`,
          );
          return;
        }
      }

      // Pure asset multi-send: no sats dust bump / change planning.
      let plan: Awaited<ReturnType<typeof prepareDustSafeSend>> = {
        amount: paymentSum,
        amountBumped: false,
        originalAmount: paymentSum,
        selectedVtxos: undefined,
      };
      if (!wantsAsset || paymentSum > 0) {
        plan = await prepareDustSafeSend(wallet, paymentSum, dust);
      }
      if (plan.amountBumped) {
        const last = working[working.length - 1]!;
        const lastOriginal = last.amount;
        const delta = plan.amount - paymentSum;
        const bumpedLast = lastOriginal + delta;
        const ok = await confirmAmountBump(paymentSum, plan.amount, dust, {
          lastOriginal,
          lastBumped: bumpedLast,
        });
        if (!ok) return;
        last.amount = bumpedLast;
        paymentSum = plan.amount;
        // Reflect bump on matching UI line (last complete / same address).
        setLines((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i]!.address.trim() === last.address) {
              copy[i] = { ...copy[i]!, amountStr: String(bumpedLast) };
              break;
            }
          }
          return copy;
        });
      }

      const auth = await requireUserPresence(
        working.length > 1 ? "Confirm multi-send" : "Confirm send",
      );
      if (!auth.ok) {
        Alert.alert("Authentication required", auth.reason);
        return;
      }

      beginOutboundSend();
      try {
        const primaryAddr = working[0]!.address;
        notePendingSendFromThisDevice(
          network.id,
          selectedWallet?.id ?? "",
          paymentSum,
          primaryAddr,
          working,
        );
        const prevAvailable = balance?.available ?? null;
        const walletId = selectedWallet?.id;
        const { txid, via } = await waitForSendOrSpendDrop(wallet, {
          recipients: working,
          selectedVtxos: plan.selectedVtxos,
          prevAvailable,
          timeoutMs: SEND_TIMEOUT_MS,
          onRealTxid: (real) => {
            if (!walletId || !real || real.startsWith("pending:")) return;
            recordSentFromThisDevice(network.id, walletId, real);
            void import("../account/activityStore")
              .then(({ upgradeLatestPendingSendTxid }) => {
                const upgraded = upgradeLatestPendingSendTxid(
                  network.id,
                  walletId,
                  real,
                );
                if (upgraded) bumpActivity();
              })
              .catch(() => {});
          },
        });
        console.warn("[basic] send settled", {
          via,
          txid: txid.slice(0, 16),
          n: working.length,
        });
        if (walletId && txid) {
          recordSentFromThisDevice(network.id, walletId, txid);
        }

        applyLocalSpend(paymentSum);

        const assetLegs = working.flatMap((r) => r.assets ?? []);
        const assetDisplaySum = wantsAsset
          ? lines.reduce((s, l) => s + (parseBrlDisplay(l.amountStr) ?? 0), 0)
          : 0;
        if (wantsAsset && assetDisplaySum > 0) {
          applyLocalDepixSpend(assetDisplaySum);
        }
        const amountLabel =
          wantsAsset && assetDisplaySum > 0
            ? `−${formatBrlDisplay(assetDisplaySum, { networkId: network.id })}`
            : undefined;

        let activityIdForNotice = txid;
        if (walletId) {
          try {
            const { recordOptimisticArkadeSend, upgradeLatestPendingSendTxid } =
              await import("../account/activityStore");
            activityIdForNotice = recordOptimisticArkadeSend(network.id, walletId, {
              amountSats: paymentSum,
              txid,
              address: primaryAddr,
              recipients: working,
              assets: assetLegs.length
                ? assetLegs.map((a) => ({
                    assetId: a.assetId,
                    amount: a.amount,
                  }))
                : undefined,
            });
            // Spend-drop may have returned pending:… while send already resolved.
            if (
              (activityIdForNotice.startsWith("pending:") ||
                activityIdForNotice.startsWith("local-send:")) &&
              /^[0-9a-fA-F]{64}$/.test(txid)
            ) {
              const upgraded = upgradeLatestPendingSendTxid(
                network.id,
                walletId,
                txid,
              );
              if (upgraded) activityIdForNotice = upgraded;
            }
            bumpActivity();
          } catch (e) {
            console.warn("[basic] optimistic send activity failed", e);
          }
        }

        const fresh = newSendLine();
        setLines([fresh]);
        setActiveLineId(fresh.id);
        setBusy(false);
        openFundsSent({
          amount: paymentSum,
          amountLabel,
          txid: activityIdForNotice,
          address: primaryAddr,
          recipientCount: working.length,
        });

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
      const msg = formatSendError(e, dust);
      if (/Insufficient sats/i.test(msg)) {
        void refreshBalanceOnly();
      }
      Alert.alert(
        "Send failed",
        fiatMode && /Insufficient sats/i.test(msg)
          ? `${msg} In Fiat Mode, Home shows stable balance — convert more or wait for sats to settle.`
          : msg,
      );
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
                        onPress={() => fillMaxSend()}
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
        <ScrollView
          style={styles.arkScroll}
          contentContainerStyle={styles.arkScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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

          {lines.length > 1 ? (
            <>
              {/* Penpot 16b/16c — all recipients as compact cards, no To pickers */}
              <Text style={styles.fieldLabel}>
                Recipients · {lines.length}
              </Text>
              {lines.map((line) => (
                <View key={line.id} style={styles.compactCard}>
                  <View style={styles.compactCardText}>
                    {line.walletLabel ? (
                      <Text style={styles.destPreviewLabel} numberOfLines={1}>
                        My wallet · {line.walletLabel}
                      </Text>
                    ) : null}
                    <Text style={styles.compactAddr} numberOfLines={1}>
                      {truncateDest(line.address.trim() || "—", 12, 8)}
                    </Text>
                    <Text style={styles.compactAmt}>
                      {fiatMode || line.assetId
                        ? formatBrlDisplay(
                            Number(String(line.amountStr).replace(",", ".")) || 0,
                          )
                        : `${(parseAmountSats(line.amountStr) ?? 0).toLocaleString("en-US")} sats`}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => removeRecipientLine(line.id)}
                    hitSlop={10}
                    accessibilityLabel="Remove recipient"
                  >
                    <Text style={styles.compactRemove}>×</Text>
                  </Pressable>
                </View>
              ))}
            </>
          ) : (
            <>
              {/* Penpot 16 — single recipient: classic Send (no card) */}
              <View style={styles.toRow}>
                <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
                  {fiatMode ? `Amount (${fiatUnit})` : "Amount (sats)"}
                </Text>
                <Pressable
                  onPress={() => fillMaxSend("primary")}
                  disabled={
                    fiatMode
                      ? !(depixDisplay != null && depixDisplay > 0)
                      : spendable == null || spendable <= 0
                  }
                  hitSlop={8}
                  accessibilityLabel="Max send"
                >
                  <Text
                    style={[
                      styles.maxLink,
                      (fiatMode
                        ? !(depixDisplay != null && depixDisplay > 0)
                        : spendable == null || spendable <= 0) && styles.maxLinkDisabled,
                    ]}
                  >
                    Max send
                  </Text>
                </Pressable>
              </View>
              <TextInput
                value={primaryLine?.amountStr ?? ""}
                editable={!busy && !sendBlocked}
                onChangeText={(v) => {
                  setPickerTarget("primary");
                  if (primaryLine) {
                    patchLine(primaryLine.id, {
                      amountStr: v,
                      ...(fiatMode ? { assetId: depixAssetId } : {}),
                    });
                  }
                }}
                onFocus={() => {
                  setPickerTarget("primary");
                  if (primaryLine) setActiveLineId(primaryLine.id);
                }}
                keyboardType={fiatMode ? "decimal-pad" : "number-pad"}
                placeholder={fiatMode ? "0.00" : "0"}
                placeholderTextColor={colors.hint}
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>To:</Text>
              {primaryHasDest ? (
                <View style={styles.destPreview}>
                  <View style={styles.destPreviewTextWrap}>
                    {primaryLine?.walletLabel ? (
                      <Text style={styles.destPreviewLabel} numberOfLines={1}>
                        My wallet · {primaryLine.walletLabel}
                      </Text>
                    ) : null}
                    <Text style={styles.destPreviewAddr} numberOfLines={2}>
                      {truncateDest(primaryLine!.address.trim(), 14, 10)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={clearPrimaryDestination}
                    hitSlop={8}
                    accessibilityLabel="Clear destination"
                  >
                    <Text style={styles.scanLink}>Clear</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.toActions}>
                <Pressable
                  style={styles.toAction}
                  onPress={() => openEnterSheet("primary")}
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
                  onPress={() => void pasteDestination("primary")}
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
                    onPress={() => {
                      setPickerTarget("primary");
                      setMyWalletsSheetOpen(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="My wallets"
                  >
                    <View style={styles.toActionIcon}>
                      <IconMyWallets />
                    </View>
                    <Text style={styles.toActionLabel}>My wallets</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.toAction}
                  onPress={() => {
                    setPickerTarget("primary");
                    setScanOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Scan QR"
                >
                  <View style={styles.toActionIcon}>
                    <IconQr size={28} />
                  </View>
                  <Text style={styles.toActionLabel}>Scan</Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable
            style={[styles.addRecipient, !canAddRecipient && { opacity: 0.4 }]}
            disabled={!canAddRecipient || busy}
            onPress={openAddRecipientSheet}
            accessibilityRole="button"
            accessibilityLabel="Add recipient"
          >
            <Text style={styles.addRecipientText}>+ Add recipient</Text>
          </Pressable>
          {lines.length === 1 && !canAddRecipient && !primaryHasDest ? (
            <Text style={styles.addHint}>
              Set the first ark… destination to add more recipients.
            </Text>
          ) : null}

          {lines.length > 1 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>
                {arkTotal.toLocaleString("en-US")} sats
              </Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.primary, (busy || sendBlocked || !!myWalletPeekId) && { opacity: 0.6 }]}
            disabled={busy || sendBlocked || !!myWalletPeekId}
            onPress={() => void onSend()}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.primaryText}>
                {lines.length > 1 ? "Confirm multi-send" : "Confirm send"}
              </Text>
            )}
          </Pressable>
        </ScrollView>

        <ScanQrModal
          visible={scanOpen}
          onClose={() => setScanOpen(false)}
          parse={extractArkAddressFromScan}
          onScan={applyScannedPay}
        />
      </ScreenChrome>

      {/* Penpot 16d — Add recipient first in tree so Enter/My wallets stack above */}
      <InteractiveBottomSheet
        open={addSheetOpen}
        onDismiss={closeAddRecipientSheet}
        visibleFraction={0.62}
        avoidKeyboard
      >
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={[
            styles.addSheetContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 20 },
          ]}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sheetTitle}>ADD RECIPIENT</Text>
          <Text style={styles.sheetCaption}>Same pickers as To:</Text>

          {addDraftAddress.trim() ? (
            <View style={[styles.destPreview, { marginBottom: 12 }]}>
              <View style={styles.destPreviewTextWrap}>
                {addDraftLabel ? (
                  <Text style={styles.destPreviewLabel} numberOfLines={1}>
                    My wallet · {addDraftLabel}
                  </Text>
                ) : null}
                <Text style={styles.destPreviewAddr} numberOfLines={2}>
                  {truncateDest(addDraftAddress.trim(), 14, 10)}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setAddDraftAddress("");
                  setAddDraftLabel(null);
                }}
                hitSlop={8}
                accessibilityLabel="Clear destination"
              >
                <Text style={styles.scanLink}>Clear</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.toActions}>
            <Pressable
              style={styles.toAction}
              onPress={() => openEnterSheet("add")}
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
              onPress={() => void pasteDestination("add")}
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
                onPress={() => {
                  setPickerTarget("add");
                  setMyWalletsSheetOpen(true);
                }}
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

          <View style={styles.toRow}>
            <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
              {fiatMode ? `Amount (${fiatUnit})` : "Amount (sats)"}
            </Text>
            <Pressable
              onPress={() => fillMaxSend("add")}
              disabled={
                fiatMode
                  ? !(depixDisplay != null && depixDisplay > 0)
                  : spendable == null || spendable <= 0
              }
              hitSlop={8}
              accessibilityLabel="Max send"
            >
              <Text
                style={[
                  styles.maxLink,
                  (fiatMode
                    ? !(depixDisplay != null && depixDisplay > 0)
                    : spendable == null || spendable <= 0) && styles.maxLinkDisabled,
                ]}
              >
                Max
              </Text>
            </Pressable>
          </View>
          <TextInput
            value={addDraftAmount}
            onChangeText={setAddDraftAmount}
            keyboardType={fiatMode ? "decimal-pad" : "number-pad"}
            placeholder={fiatMode ? "0.00" : "0"}
            placeholderTextColor={colors.hint}
            style={[styles.input, { marginBottom: 12 }]}
          />

          <Pressable
            style={[
              styles.primary,
              { marginTop: 0 },
              (!addDraftAddress.trim() || !addDraftAmount.trim()) && { opacity: 0.5 },
            ]}
            disabled={!addDraftAddress.trim() || !addDraftAmount.trim()}
            onPress={confirmAddRecipient}
          >
            <Text style={styles.primaryText}>Add</Text>
          </Pressable>
          <Pressable onPress={closeAddRecipientSheet} hitSlop={8} style={{ marginTop: 14 }}>
            <Text style={[styles.sheetCaption, { marginBottom: 0 }]}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </InteractiveBottomSheet>

      <InteractiveBottomSheet
        open={enterSheetOpen}
        onDismiss={closeEnterSheet}
        visibleFraction={0.72}
        avoidKeyboard
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetTitle}>ENTER</Text>
          <Text style={styles.sheetCaption}>
            Paste a destination or pick a contact
          </Text>
          <TextInput
            ref={enterInputRef}
            value={enterDraft}
            onChangeText={setEnterDraft}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={isLightning ? "lnbc… · user@domain · lnurl…" : "ark1…"}
            placeholderTextColor={colors.hint}
            multiline
            style={[styles.input, styles.inputMulti, { marginBottom: 12 }]}
          />
          <Pressable
            style={[styles.primary, { marginTop: 0 }, !enterDraft.trim() && { opacity: 0.5 }]}
            disabled={!enterDraft.trim() || contactResolveBusy}
            onPress={confirmEnterDestination}
          >
            <Text style={styles.primaryText}>Use destination</Text>
          </Pressable>

          <TextInput
            value={contactQuery}
            onChangeText={setContactQuery}
            placeholder="Search contacts…"
            placeholderTextColor={colors.hint}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { marginTop: 14, marginBottom: 8 }]}
          />
          {contactResolveBusy ? (
            <ActivityIndicator color={colors.fg} style={{ marginVertical: 8 }} />
          ) : null}
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <ContactPickList
              contacts={filteredContacts}
              onPick={onPickContact}
              emptyLabel={
                contactList.length === 0
                  ? "No contacts yet — add some in Settings"
                  : "No matches"
              }
            />
          </ScrollView>
        </View>
      </InteractiveBottomSheet>

      <InteractiveBottomSheet
        open={!!idPickerContact}
        onDismiss={() => setIdPickerContact(null)}
        visibleFraction={0.5}
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetTitle}>PICK IDENTIFIER</Text>
          <Text style={styles.sheetCaption}>{idPickerContact?.name}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {(idPickerContact?.identifiers ?? []).map((ident) => {
              const ok = identifierEligible(ident);
              return (
                <Pressable
                  key={ident.id}
                  style={[styles.myWalletRow, !ok && { opacity: 0.45 }]}
                  onPress={() => {
                    if (!idPickerContact) return;
                    void applyContactIdentifier(idPickerContact, ident);
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.myWalletLabel} numberOfLines={1}>
                      {kindPillLabel(ident)}
                      {ident.label ? ` · ${ident.label}` : ""}
                    </Text>
                    <Text style={[styles.sheetCaption, { marginBottom: 0, textAlign: "left" }]} numberOfLines={1}>
                      {contactMidEllipsis(ident.value, 14, 8)}
                    </Text>
                  </View>
                  <Text style={styles.myWalletAction}>{ok ? "Use" : "…"}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </InteractiveBottomSheet>

      <SaveToContactsSheet
        open={saveAfterEnterOpen}
        destination={saveAfterEnterDest}
        onDismiss={() => {
          setSaveAfterEnterOpen(false);
          setSaveAfterEnterDest("");
        }}
      />

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
              const selected =
                pickerTarget === "add"
                  ? addDraftLabel === w.label && !!addDraftAddress.trim()
                  : primaryLine?.walletLabel === w.label && primaryHasDest;
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
  arkScroll: {
    flex: 1,
  },
  arkScrollContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  compactCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    backgroundColor: "#0D0D0D",
    gap: 10,
  },
  compactCardText: {
    flex: 1,
    minWidth: 0,
  },
  compactAddr: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.fg,
  },
  compactAmt: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    marginTop: 4,
  },
  compactRemove: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 22,
    color: colors.hint,
    paddingHorizontal: 6,
  },
  addRecipient: {
    borderWidth: 1.5,
    borderColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 8,
    marginTop: 4,
    backgroundColor: "#111111",
  },
  addRecipientText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
  addHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 16,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  totalLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
  },
  totalValue: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
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
  addSheetContent: {
    paddingTop: 4,
    flexGrow: 1,
  },
  sheetTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
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
