/**
 * Hosts interactive sheets above the stack.
 * Wallets is one sheet with internal steps: list → edit | add | import | connect*.
 * OS back walks that stack. Activity = bottom sheet; POS/Scan = side pages;
 * Funds* = full-screen overlays. Settings is a normal stack screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { BackHandler, Dimensions, StyleSheet, View } from "react-native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useSharedValue } from "react-native-reanimated";
import {
  InteractiveBottomSheet,
  type InteractiveBottomSheetRef,
  type SheetMotionShared,
} from "../components/sheet/InteractiveBottomSheet";
import {
  InteractiveSideSheet,
  type InteractiveSideSheetRef,
  type SideMotionShared,
} from "../components/sheet/InteractiveSideSheet";
import { sideOffX, snapTranslate } from "../components/sheet/sheetMotion";
import { FundsNoticeOverlay } from "../components/FundsNoticeOverlay";
import type { RootNav } from "./types";
import type { NodeStatusPayload } from "./connectFlow";
import {
  isConnectWalletStep,
  type WalletFlowStep,
} from "./walletFlow";
import { ActivitySheetContent } from "../screens/ActivitySheetContent";
import { ActivityDetailView } from "../screens/ActivityDetailScreen";
import type { ActivityFlowStep } from "./activityFlow";
import { WalletSwitcherSheetContent } from "../screens/WalletSwitcherSheetContent";
import { EditWalletSheetContent } from "../screens/EditWalletSheetContent";
import { AddWalletSheetContent } from "../screens/AddWalletSheetContent";
import { ConnectNodeSheetContent } from "../screens/ConnectNodeSheetContent";
import { ConnectLndHubSheetContent } from "../screens/ConnectLndHubSheetContent";
import { ConnectBtcPaySheetContent } from "../screens/ConnectBtcPaySheetContent";
import { NodeStatusSheetContent } from "../screens/NodeStatusSheetContent";
import { RestoreWalletContent } from "../screens/RestoreWalletContent";
import { FundsReceivedView } from "../screens/FundsReceivedView";
import { findRecentReceiveActivityId, findActivityIdByTxid, findRecentSendActivityId } from "../account/activityStore";
import { getNetworkConfig } from "../config/network";
import { FundsSentView } from "../screens/FundsSentView";
import { SaveToContactsSheet } from "../components/contacts/SaveToContactsSheet";
import { findContactByIdentifierValue } from "../contacts/contactStore";
import { HomePosSheetContent } from "../screens/HomePosSheetContent";
import {
  ScanQrView,
  extractArkAddressFromScan,
  extractLightningPayFromScan,
} from "../screens/ScanQrModal";
import { getMnemonicSource } from "../wallet/mnemonicMeta";
import { resolvePayIntent } from "../wallet/bip21Pay";
import { useWallet } from "../wallet/WalletProvider";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { FiatModeEnterSheetContent } from "../fiat/FiatModeEnterSheetContent";
import { FiatModeExitSheetContent } from "../fiat/FiatModeExitSheetContent";
import { requireUserPresence } from "../security/userPresence";

export type FundsSentPayload = {
  amount: number;
  txid: string;
  address?: string;
  /** Ark multi-send: number of payment outputs (one tx). */
  recipientCount?: number;
  rail?: "arkade" | "lightning";
  /** When set, notice shows fiat (−R$ / −$) instead of sats. */
  amountLabel?: string;
};

export type FundsReceivedPayload = {
  amount: number;
  kind: "boarding" | "arkade" | "lightning" | "brl";
};

type SheetsApi = {
  openActivity: () => void;
  openWalletSwitcher: () => void;
  openAddWallet: () => void;
  openImportWallet: () => void;
  openConnectNode: () => void;
  openConnectLndHub: () => void;
  openConnectBtcPay: () => void;
  openNodeStatus: (payload: NodeStatusPayload) => void;
  openFundsSent: (payload: FundsSentPayload) => void;
  openFundsReceived: (payload: FundsReceivedPayload) => void;
  /** Home: Enter Fiat Mode confirm as InteractiveBottomSheet (not a page). */
  openFiatModeEnter: () => void;
  /** Home: Exit Fiat Mode confirm as InteractiveBottomSheet. */
  openFiatModeExit: () => void;
  /** Open Save to contacts sheet over current UI (Activity detail / Funds sent). */
  openSaveToContacts: (destination: string) => void;
  openPosSheet: () => void;
  openScanSheet: () => void;
  dismissActivity: () => void;
  dismissWalletSwitcher: () => void;
  dismissAddWallet: () => void;
  dismissImportWallet: () => void;
  dismissConnectNode: () => void;
  dismissFundsReceived: () => void;
  dismissFundsSent: () => void;
  dismissFiatModeSheet: () => void;
  dismissPosSheet: () => void;
  dismissScanSheet: () => void;
  activitySheetRef: RefObject<InteractiveBottomSheetRef | null>;
  beginActivityDrag: () => void;
  beginPosDrag: () => void;
  beginScanDrag: () => void;
  /** After interactive open snap — block Home under the sheet. */
  settlePosOpen: () => void;
  settleScanOpen: () => void;
  setActivityAnchorY: (y: number) => void;
  activityOpen: boolean;
  posOpen: boolean;
  scanOpen: boolean;
  /** True while Home finger is still driving the interactive open. */
  posSkipEnter: boolean;
  scanSkipEnter: boolean;
  walletOpen: boolean;
  /** Derived: wallets sheet is on the add step. */
  addWalletOpen: boolean;
  importWalletOpen: boolean;
  connectNodeOpen: boolean;
  fundsReceivedOpen: boolean;
  fundsSentOpen: boolean;
  fiatModeSheetOpen: boolean;
  activityMotion: SheetMotionShared;
  posMotion: SideMotionShared;
  scanMotion: SideMotionShared;
  setHomeDragging: (v: boolean) => void;
};

const SheetContext = createContext<SheetsApi | null>(null);

export function useSheets(): SheetsApi {
  const ctx = useContext(SheetContext);
  if (!ctx) throw new Error("useSheets requires SheetHost");
  return ctx;
}

function useSheetMotion(initialOff: number): SheetMotionShared {
  const translateY = useSharedValue(initialOff);
  const openY = useSharedValue(snapTranslate(initialOff, 0));
  const revealY = useSharedValue(initialOff);
  const offY = useSharedValue(initialOff);
  const windowH = useSharedValue(initialOff);
  const dragStartY = useSharedValue(initialOff);
  return useMemo(
    () => ({ translateY, openY, revealY, offY, windowH, dragStartY }),
    [translateY, openY, revealY, offY, windowH, dragStartY],
  );
}

function useSideMotion(initialOff: number): SideMotionShared {
  const translateX = useSharedValue(initialOff);
  const openX = useSharedValue(0);
  const offX = useSharedValue(initialOff);
  const windowW = useSharedValue(Math.abs(initialOff) || 1);
  const dragStartX = useSharedValue(initialOff);
  return useMemo(
    () => ({ translateX, openX, offX, windowW, dragStartX }),
    [translateX, openX, offX, windowW, dragStartX],
  );
}

function closeNoticeSheets(
  setFundsSentOpen: (v: boolean) => void,
  setFundsSentPayload: (v: FundsSentPayload | null) => void,
  setFundsReceivedOpen: (v: boolean) => void,
  setFundsReceivedPayload: (v: null) => void,
  clearFundsNotice: () => void,
) {
  setFundsSentOpen(false);
  setFundsSentPayload(null);
  setFundsReceivedOpen(false);
  setFundsReceivedPayload(null);
  clearFundsNotice();
}

export function SheetHost({ children }: { children: ReactNode }) {
  const navigation = useNavigation<RootNav>();
  const { fundsNotice, clearFundsNotice, selectedWallet, setPosUiHold, walletInteractive, balanceSats } =
    useWallet();
  const { confirmEnter, confirmExit, fiatMode, converting, depixDisplay } = useFiatMode();

  const activityRef = useRef<InteractiveBottomSheetRef>(null);
  const walletRef = useRef<InteractiveBottomSheetRef>(null);
  const fiatModeRef = useRef<InteractiveBottomSheetRef>(null);
  const posRef = useRef<InteractiveSideSheetRef>(null);
  const scanRef = useRef<InteractiveSideSheetRef>(null);

  const windowHeight = Dimensions.get("window").height;
  const windowWidth = Dimensions.get("window").width;
  const activityMotion = useSheetMotion(windowHeight);
  const posMotion = useSideMotion(sideOffX(windowWidth, "left"));
  const scanMotion = useSideMotion(sideOffX(windowWidth, "right"));

  const [activityOpen, setActivityOpen] = useState(false);
  const [activityStep, setActivityStep] = useState<ActivityFlowStep>("list");
  const [activityDetailId, setActivityDetailId] = useState<string | null>(null);
  const [activityDetailWalletId, setActivityDetailWalletId] = useState<string | null>(
    null,
  );
  const [posOpen, setPosOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [posSkipEnter, setPosSkipEnter] = useState(false);
  const [scanSkipEnter, setScanSkipEnter] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletStep, setWalletStep] = useState<WalletFlowStep>("list");
  const [editWalletId, setEditWalletId] = useState<string | null>(null);
  const [importReturnStep, setImportReturnStep] = useState<"list" | "add">("list");
  const [nodeStatusPayload, setNodeStatusPayload] =
    useState<NodeStatusPayload | null>(null);
  const [importPasskeyNote, setImportPasskeyNote] = useState(false);
  const [fundsReceivedOpen, setFundsReceivedOpen] = useState(false);
  const [fundsReceivedPayload, setFundsReceivedPayload] = useState<FundsReceivedPayload | null>(
    null,
  );
  const [fundsSentOpen, setFundsSentOpen] = useState(false);
  const [fundsSentPayload, setFundsSentPayload] = useState<FundsSentPayload | null>(
    null,
  );
  const [saveContactOpen, setSaveContactOpen] = useState(false);
  const [saveContactDest, setSaveContactDest] = useState("");
  const [fiatModeSheet, setFiatModeSheet] = useState<"enter" | "exit" | null>(null);
  const [activitySkipEnter, setActivitySkipEnter] = useState(false);
  const [activityAnchorY, setActivityAnchorYState] = useState<number | null>(null);
  const [, setHomeDragging] = useState(false);

  const addWalletOpen = walletOpen && walletStep === "add";
  const importWalletOpen = walletOpen && walletStep === "import";
  const connectNodeOpen = walletOpen && isConnectWalletStep(walletStep);
  const isLightning = selectedWallet?.kind === "lightning";

  const resetWalletFlow = useCallback(() => {
    setWalletStep("list");
    setEditWalletId(null);
    setNodeStatusPayload(null);
    setImportReturnStep("list");
  }, []);

  const resetActivityFlow = useCallback(() => {
    setActivityStep("list");
    setActivityDetailId(null);
    setActivityDetailWalletId(null);
  }, []);

  const dismissActivity = useCallback(() => {
    setActivityOpen(false);
    setActivitySkipEnter(false);
    resetActivityFlow();
  }, [resetActivityFlow]);

  const dismissWalletSwitcher = useCallback(() => {
    setWalletOpen(false);
    resetWalletFlow();
  }, [resetWalletFlow]);

  const dismissAddWallet = useCallback(() => {
    setWalletStep("list");
    setEditWalletId(null);
  }, []);

  const dismissImportWallet = useCallback(() => {
    setWalletStep(importReturnStep);
  }, [importReturnStep]);

  const dismissConnectNode = useCallback(() => {
    setWalletStep("list");
    setNodeStatusPayload(null);
  }, []);

  const dismissFundsReceived = useCallback(() => {
    setFundsReceivedOpen(false);
    setFundsReceivedPayload(null);
    clearFundsNotice();
  }, [clearFundsNotice]);

  const dismissFundsSent = useCallback(() => {
    setFundsSentOpen(false);
    setFundsSentPayload(null);
  }, []);

  const dismissPosSheet = useCallback(() => {
    setPosOpen(false);
    setPosSkipEnter(false);
  }, []);

  const dismissScanSheet = useCallback(() => {
    setScanOpen(false);
    setScanSkipEnter(false);
  }, []);

  const dismissActivityAnimated = useCallback(() => {
    activityRef.current?.dismiss() ?? dismissActivity();
  }, [dismissActivity]);

  /** Same idea as popWalletStep: walk Activity sheet steps before closing. */
  const popActivityStep = useCallback((): boolean => {
    if (!activityOpen) return false;
    if (activityStep === "detail") {
      setActivityStep("list");
      setActivityDetailId(null);
      setActivityDetailWalletId(null);
      return true;
    }
    dismissActivityAnimated();
    return true;
  }, [activityOpen, activityStep, dismissActivityAnimated]);

  const dismissWalletAnimated = useCallback(() => {
    walletRef.current?.dismiss() ?? dismissWalletSwitcher();
  }, [dismissWalletSwitcher]);

  const dismissPosAnimated = useCallback(() => {
    posRef.current?.dismiss() ?? dismissPosSheet();
  }, [dismissPosSheet]);

  const dismissScanAnimated = useCallback(() => {
    // Drop camera / barcode callbacks immediately — then spring closed.
    setScanOpen(false);
    setScanSkipEnter(false);
    scanRef.current?.dismiss();
  }, []);

  const prepareWalletSheet = useCallback(() => {
    setActivityOpen(false);
    setPosOpen(false);
    setPosSkipEnter(false);
    setScanOpen(false);
    setScanSkipEnter(false);
    setFiatModeSheet(null);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    setActivitySkipEnter(false);
  }, [clearFundsNotice]);

  const openWalletAt = useCallback(
    (step: WalletFlowStep) => {
      prepareWalletSheet();
      setEditWalletId(null);
      if (step !== "import") setImportReturnStep("list");
      if (!isConnectWalletStep(step)) setNodeStatusPayload(null);
      setWalletStep(step);
      setWalletOpen(true);
    },
    [prepareWalletSheet],
  );

  const openActivity = useCallback(() => {
    setWalletOpen(false);
    resetWalletFlow();
    setPosOpen(false);
    setPosSkipEnter(false);
    setScanOpen(false);
    setScanSkipEnter(false);
    setFiatModeSheet(null);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    setActivitySkipEnter(false);
    resetActivityFlow();
    setActivityOpen(true);
  }, [clearFundsNotice, resetActivityFlow, resetWalletFlow]);

  const openWalletSwitcher = useCallback(() => {
    openWalletAt("list");
  }, [openWalletAt]);

  const openAddWallet = useCallback(() => {
    openWalletAt("add");
  }, [openWalletAt]);

  const openImportWallet = useCallback(() => {
    prepareWalletSheet();
    setImportReturnStep("list");
    void getMnemonicSource().then((s) => {
      setImportPasskeyNote(s === "passkey-prf");
      setWalletStep("import");
      setWalletOpen(true);
    });
  }, [prepareWalletSheet]);

  const openConnectNode = useCallback(() => {
    openWalletAt("connect-menu");
  }, [openWalletAt]);

  const openConnectLndHub = useCallback(() => {
    openWalletAt("connect-lndhub");
  }, [openWalletAt]);

  const openConnectBtcPay = useCallback(() => {
    openWalletAt("connect-btcpay");
  }, [openWalletAt]);

  const openNodeStatus = useCallback(
    (payload: NodeStatusPayload) => {
      prepareWalletSheet();
      setNodeStatusPayload(payload);
      setWalletStep("connect-status");
      setWalletOpen(true);
    },
    [prepareWalletSheet],
  );

  const openFundsSent = useCallback(
    (payload: FundsSentPayload) => {
      setActivityOpen(false);
      setWalletOpen(false);
      resetWalletFlow();
      setFiatModeSheet(null);
      setFundsReceivedOpen(false);
      setFundsReceivedPayload(null);
      clearFundsNotice();
      setFundsSentPayload(payload);
      setFundsSentOpen(true);
    },
    [clearFundsNotice, resetWalletFlow],
  );

  const openFundsReceived = useCallback(
    (payload: FundsReceivedPayload) => {
      setActivityOpen(false);
      setWalletOpen(false);
      resetWalletFlow();
      setPosOpen(false);
      setPosSkipEnter(false);
      setScanOpen(false);
      setScanSkipEnter(false);
      setFiatModeSheet(null);
      setFundsSentOpen(false);
      setFundsSentPayload(null);
      clearFundsNotice();
      setFundsReceivedPayload(payload);
      setFundsReceivedOpen(true);
    },
    [clearFundsNotice, resetWalletFlow],
  );

  const openSaveToContacts = useCallback((destination: string) => {
    const dest = destination.trim();
    if (!dest) return;
    setSaveContactDest(dest);
    setSaveContactOpen(true);
  }, []);

  /** Clear kind only after spring dismiss so the sheet never shows an empty body. */
  const clearFiatModeSheet = useCallback(() => {
    setFiatModeSheet(null);
  }, []);

  const dismissFiatModeSheet = useCallback(() => {
    if (fiatModeSheet == null) return;
    fiatModeRef.current?.dismiss() ?? setFiatModeSheet(null);
  }, [fiatModeSheet]);

  const openFiatModeEnter = useCallback(() => {
    if (selectedWallet?.kind !== "arkade" || fiatMode || converting) return;
    setActivityOpen(false);
    setWalletOpen(false);
    resetWalletFlow();
    setPosOpen(false);
    setPosSkipEnter(false);
    setScanOpen(false);
    setScanSkipEnter(false);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    setFiatModeSheet("enter");
  }, [
    selectedWallet?.kind,
    fiatMode,
    converting,
    resetWalletFlow,
    clearFundsNotice,
  ]);

  const openFiatModeExit = useCallback(() => {
    if (selectedWallet?.kind !== "arkade" || !fiatMode || converting) return;
    setActivityOpen(false);
    setWalletOpen(false);
    resetWalletFlow();
    setPosOpen(false);
    setPosSkipEnter(false);
    setScanOpen(false);
    setScanSkipEnter(false);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    setFiatModeSheet("exit");
  }, [
    selectedWallet?.kind,
    fiatMode,
    converting,
    resetWalletFlow,
    clearFundsNotice,
  ]);

  const beginActivityDrag = useCallback(() => {
    setWalletOpen(false);
    resetWalletFlow();
    setPosOpen(false);
    setPosSkipEnter(false);
    setScanOpen(false);
    setScanSkipEnter(false);
    setFiatModeSheet(null);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    setActivitySkipEnter(true);
    resetActivityFlow();
    setActivityOpen(true);
    setHomeDragging(true);
  }, [clearFundsNotice, resetActivityFlow, resetWalletFlow]);

  const beginPosDrag = useCallback(() => {
    // Activity open/dragging owns the gesture — never flash POS underneath.
    if (activityOpen) return;
    // Scan already open — do not steal via Home swipe.
    if (scanOpen) return;
    setActivityOpen(false);
    setWalletOpen(false);
    resetWalletFlow();
    setScanOpen(false);
    setScanSkipEnter(false);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    // Home gesture already drives translateX — do not snap off mid-drag.
    // Keep skipEnter true until settlePosOpen so Home stays touchable mid-swipe.
    setPosSkipEnter(true);
    setPosOpen(true);
  }, [activityOpen, clearFundsNotice, resetWalletFlow, scanOpen]);

  const settlePosOpen = useCallback(() => {
    setPosSkipEnter(false);
  }, []);

  const beginScanDrag = useCallback(() => {
    if (activityOpen) return;
    // POS already open — never open Scan underneath / replace it.
    if (posOpen) return;
    // Already open (or mid interactive open) — avoid a second enter spring.
    if (scanOpen) return;
    setActivityOpen(false);
    setWalletOpen(false);
    resetWalletFlow();
    setPosOpen(false);
    setPosSkipEnter(false);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    setScanSkipEnter(true);
    setScanOpen(true);
  }, [activityOpen, clearFundsNotice, posOpen, resetWalletFlow, scanOpen]);

  const settleScanOpen = useCallback(() => {
    setScanSkipEnter(false);
  }, []);

  const openPosSheet = useCallback(() => {
    setActivityOpen(false);
    setWalletOpen(false);
    resetWalletFlow();
    setScanOpen(false);
    setScanSkipEnter(false);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    setPosSkipEnter(false);
    setPosOpen(true);
  }, [clearFundsNotice, resetWalletFlow]);

  const openScanSheet = useCallback(() => {
    // Interactive swipe already owns the sheet — do not re-run enter spring.
    if (scanOpen || scanSkipEnter) return;
    setActivityOpen(false);
    setWalletOpen(false);
    resetWalletFlow();
    setPosOpen(false);
    setPosSkipEnter(false);
    closeNoticeSheets(
      setFundsSentOpen,
      setFundsSentPayload,
      setFundsReceivedOpen,
      setFundsReceivedPayload,
      clearFundsNotice,
    );
    setScanSkipEnter(false);
    setScanOpen(true);
  }, [clearFundsNotice, resetWalletFlow, scanOpen, scanSkipEnter]);

  const setActivityAnchorY = useCallback(
    (y: number) => {
      if (y > 0) {
        setActivityAnchorYState(y);
        activityMotion.revealY.value = y;
      }
    },
    [activityMotion.revealY],
  );

  useEffect(() => {
    if (!fundsNotice) return;
    console.warn("[basic] FundsNotice overlay", fundsNotice);
    // Close POS / Scan under the notice first — otherwise Done→Home flashes POS
    // for a frame while FundsReceived unmounts. Snap motion off immediately so
    // the side-sheet scrim cannot leave a dim layer on Home.
    setActivityOpen(false);
    setWalletOpen(false);
    resetWalletFlow();
    setPosOpen(false);
    setPosSkipEnter(false);
    setScanOpen(false);
    setScanSkipEnter(false);
    posMotion.translateX.value = posMotion.offX.value;
    scanMotion.translateX.value = scanMotion.offX.value;
    setFundsSentOpen(false);
    setFundsReceivedPayload(fundsNotice);
    setFundsReceivedOpen(true);
  }, [fundsNotice, resetWalletFlow, posMotion, scanMotion]);

  // While POS is open, pause balance polls so keypad taps are not starved by
  // getBalance timeouts. Incoming payments still use notifyIncomingFunds.
  useEffect(() => {
    if (!posOpen) return;
    setPosUiHold(true);
    return () => setPosUiHold(false);
  }, [posOpen, setPosUiHold]);

  useEffect(() => {
    activityMotion.windowH.value = windowHeight;
    activityMotion.offY.value = windowHeight;
    activityMotion.openY.value = snapTranslate(windowHeight, 0);
  }, [activityMotion, windowHeight]);

  useEffect(() => {
    const leftOff = sideOffX(windowWidth, "left");
    const rightOff = sideOffX(windowWidth, "right");
    posMotion.windowW.value = windowWidth;
    posMotion.offX.value = leftOff;
    posMotion.openX.value = 0;
    if (!posOpen) posMotion.translateX.value = leftOff;
    scanMotion.windowW.value = windowWidth;
    scanMotion.offX.value = rightOff;
    scanMotion.openX.value = 0;
    if (!scanOpen) scanMotion.translateX.value = rightOff;
  }, [posMotion, posOpen, scanMotion, scanOpen, windowWidth]);

  const popWalletStep = useCallback((): boolean => {
    if (!walletOpen) return false;
    // Add flow owns its BackHandler (entropy sub-steps + onExitFlow).
    if (walletStep === "add") return false;
    if (walletStep === "list") {
      dismissWalletAnimated();
      return true;
    }
    if (walletStep === "edit") {
      setWalletStep("list");
      setEditWalletId(null);
      return true;
    }
    if (walletStep === "import") {
      setWalletStep(importReturnStep);
      return true;
    }
    if (walletStep === "connect-lndhub" || walletStep === "connect-btcpay") {
      setWalletStep("connect-menu");
      setNodeStatusPayload(null);
      return true;
    }
    if (walletStep === "connect-status") {
      setWalletStep("connect-menu");
      setNodeStatusPayload(null);
      return true;
    }
    if (walletStep === "connect-menu") {
      setWalletStep("list");
      return true;
    }
    return false;
  }, [dismissWalletAnimated, importReturnStep, walletOpen, walletStep]);

  const goHomeThen = useCallback(
    (fn: () => void) => {
      const route = navigation.getState()?.routes?.slice(-1)[0]?.name;
      if (route === "AddWallet" || route === "Send") {
        navigation.navigate("Home");
      } else if (route && route !== "Home") {
        navigation.navigate("Home");
      }
      requestAnimationFrame(fn);
    },
    [navigation],
  );

  /**
   * Open ActivityDetail instantly.
   * On Send/Receive: replace so back returns to Home (no Send in between).
   * Elsewhere: plain navigate (Home → Detail).
   */
  const openActivityDetailFromHome = useCallback(
    (activityId: string, walletId: string) => {
      const route = navigation.getState()?.routes?.slice(-1)[0]?.name;
      const params = { activityId, walletId };
      if (route === "Send" || route === "Receive") {
        navigation.dispatch(StackActions.replace("ActivityDetail", params));
        return;
      }
      navigation.navigate("ActivityDetail", params);
    },
    [navigation],
  );

  const finishFundsReceivedHome = useCallback(() => {
    // Defensive: drop any leftover side-sheet dim before Home paints.
    posMotion.translateX.value = posMotion.offX.value;
    scanMotion.translateX.value = scanMotion.offX.value;
    setPosOpen(false);
    setScanOpen(false);
    dismissFundsReceived();
    goHomeThen(() => {});
  }, [dismissFundsReceived, goHomeThen, posMotion, scanMotion]);

  const finishFundsReceivedHomeRef = useRef(finishFundsReceivedHome);
  finishFundsReceivedHomeRef.current = finishFundsReceivedHome;

  const onFundsReceivedDone = useCallback(() => {
    finishFundsReceivedHomeRef.current();
  }, []);

  const finishFundsSentHome = useCallback(() => {
    dismissFundsSent();
    goHomeThen(() => {});
  }, [dismissFundsSent, goHomeThen]);

  const finishFundsSentHomeRef = useRef(finishFundsSentHome);
  finishFundsSentHomeRef.current = finishFundsSentHome;

  const onFundsSentDone = useCallback(() => {
    finishFundsSentHomeRef.current();
  }, []);

  useEffect(() => {
    const anyOpen =
      fundsReceivedOpen ||
      fundsSentOpen ||
      walletOpen ||
      activityOpen ||
      posOpen ||
      scanOpen ||
      fiatModeSheet != null;
    if (!anyOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (fundsReceivedOpen) {
        finishFundsReceivedHome();
        return true;
      }
      if (fundsSentOpen) {
        finishFundsSentHome();
        return true;
      }
      if (fiatModeSheet != null) {
        dismissFiatModeSheet();
        return true;
      }
      if (posOpen) {
        dismissPosAnimated();
        return true;
      }
      if (scanOpen) {
        dismissScanAnimated();
        return true;
      }
      if (walletOpen) {
        return popWalletStep();
      }
      if (activityOpen) {
        return popActivityStep();
      }
      return false;
    });
    return () => sub.remove();
  }, [
    activityOpen,
    dismissFiatModeSheet,
    dismissPosAnimated,
    dismissScanAnimated,
    fiatModeSheet,
    finishFundsReceivedHome,
    finishFundsSentHome,
    fundsReceivedOpen,
    fundsSentOpen,
    popActivityStep,
    popWalletStep,
    posOpen,
    scanOpen,
    walletOpen,
  ]);

  const parseHomeQr = useCallback(
    (raw: string) => {
      if (isLightning) return extractLightningPayFromScan(raw);
      return extractArkAddressFromScan(raw) ?? extractLightningPayFromScan(raw);
    },
    [isLightning],
  );

  const onHomeScanned = useCallback(
    (value: string, raw?: string) => {
      dismissScanSheet();
      const intent = resolvePayIntent(raw ?? value, isLightning ? "lightning" : "arkade");
      navigation.navigate("Send", {
        to: intent?.destination ?? value,
        ...(intent?.amountSats != null ? { amountSats: intent.amountSats } : {}),
      });
    },
    [dismissScanSheet, isLightning, navigation],
  );

  const api = useMemo<SheetsApi>(
    () => ({
      openActivity,
      openWalletSwitcher,
      openAddWallet,
      openImportWallet,
      openConnectNode,
      openConnectLndHub,
      openConnectBtcPay,
      openNodeStatus,
      openFundsSent,
      openFundsReceived,
      openFiatModeEnter,
      openFiatModeExit,
      openSaveToContacts,
      openPosSheet,
      openScanSheet,
      dismissActivity,
      dismissWalletSwitcher,
      dismissAddWallet,
      dismissImportWallet,
      dismissConnectNode,
      dismissFundsReceived,
      dismissFundsSent,
      dismissFiatModeSheet,
      clearFiatModeSheet,
      dismissPosSheet,
      dismissScanSheet,
      activitySheetRef: activityRef,
      beginActivityDrag,
      beginPosDrag,
      beginScanDrag,
      settlePosOpen,
      settleScanOpen,
      setActivityAnchorY,
      activityOpen,
      posOpen,
      scanOpen,
      posSkipEnter,
      scanSkipEnter,
      walletOpen,
      addWalletOpen,
      importWalletOpen,
      connectNodeOpen,
      fundsReceivedOpen,
      fundsSentOpen,
      fiatModeSheetOpen: fiatModeSheet != null,
      activityMotion,
      posMotion,
      scanMotion,
      setHomeDragging,
    }),
    [
      activityMotion,
      activityOpen,
      addWalletOpen,
      beginActivityDrag,
      beginPosDrag,
      beginScanDrag,
      settlePosOpen,
      settleScanOpen,
      connectNodeOpen,
      dismissActivity,
      dismissAddWallet,
      dismissConnectNode,
      dismissFiatModeSheet,
      clearFiatModeSheet,
      dismissFundsReceived,
      dismissFundsSent,
      dismissImportWallet,
      dismissPosSheet,
      dismissScanSheet,
      dismissWalletSwitcher,
      fiatModeSheet,
      fundsReceivedOpen,
      fundsSentOpen,
      importWalletOpen,
      openActivity,
      openAddWallet,
      openConnectBtcPay,
      openConnectLndHub,
      openConnectNode,
      openFiatModeEnter,
      openFiatModeExit,
      openFundsSent,
      openFundsReceived,
      openSaveToContacts,
      openImportWallet,
      openNodeStatus,
      openPosSheet,
      openScanSheet,
      openWalletSwitcher,
      posMotion,
      posOpen,
      posSkipEnter,
      scanMotion,
      scanOpen,
      scanSkipEnter,
      setActivityAnchorY,
      walletOpen,
    ],
  );

  const lndHubOpen = walletOpen && walletStep === "connect-lndhub";
  const btcPayOpen = walletOpen && walletStep === "connect-btcpay";

  return (
    <SheetContext.Provider value={api}>
      <View style={styles.root}>
        {/* Block Home under a settled side sheet. While skipEnter (interactive
            open drag), keep Home touchable or the pan dies mid-swipe. */}
        <View
          style={styles.flex}
          pointerEvents={
            (posOpen && !posSkipEnter) || (scanOpen && !scanSkipEnter)
              ? "none"
              : "auto"
          }
        >
          {children}
        </View>

        <InteractiveBottomSheet
          ref={activityRef}
          open={activityOpen}
          skipEnterSnap={activitySkipEnter}
          anchorY={activityAnchorY}
          motion={activityMotion}
          onDismiss={dismissActivity}
        >
          {activityStep === "list" ||
          (activityStep === "detail" &&
            !(activityDetailId && activityDetailWalletId)) ? (
            <ActivitySheetContent
              active={activityOpen && activityStep === "list"}
              onOpenDetail={(activityId, walletId) => {
                if (!activityId || !walletId) return;
                setActivityDetailId(activityId);
                setActivityDetailWalletId(walletId);
                setActivityStep("detail");
              }}
            />
          ) : null}

          {activityStep === "detail" && activityDetailId && activityDetailWalletId ? (
            <ActivityDetailView
              presentation="sheet"
              activityId={activityDetailId}
              walletId={activityDetailWalletId}
              onBack={() => {
                setActivityStep("list");
                setActivityDetailId(null);
                setActivityDetailWalletId(null);
              }}
            />
          ) : null}
        </InteractiveBottomSheet>

        <InteractiveSideSheet
          ref={posRef}
          open={posOpen}
          side="left"
          skipEnterSnap={posSkipEnter}
          motion={posMotion}
          onDismiss={dismissPosSheet}
        >
          <HomePosSheetContent onClose={dismissPosAnimated} active={posOpen} />
        </InteractiveSideSheet>

        <InteractiveSideSheet
          ref={scanRef}
          open={scanOpen}
          side="right"
          skipEnterSnap={scanSkipEnter}
          motion={scanMotion}
          onDismiss={dismissScanSheet}
        >
          <ScanQrView
            active={scanOpen}
            acceptScans={walletInteractive}
            onClose={dismissScanAnimated}
            onScan={onHomeScanned}
            parse={parseHomeQr}
            title="SCAN"
            idleHint="Point at the QR code to pay"
            rejectHint="Not recognized — try again"
          />
        </InteractiveSideSheet>

        <InteractiveBottomSheet
          ref={walletRef}
          open={walletOpen}
          onDismiss={dismissWalletSwitcher}
        >
          {walletStep === "list" ? (
            <WalletSwitcherSheetContent
              onClose={dismissWalletSwitcher}
              onAddWallet={() => {
                setWalletStep("add");
              }}
              onEditWallet={(walletId) => {
                setEditWalletId(walletId);
                setWalletStep("edit");
              }}
              onConnectNode={() => {
                setNodeStatusPayload(null);
                setWalletStep("connect-menu");
              }}
            />
          ) : null}

          {walletStep === "edit" && editWalletId ? (
            <EditWalletSheetContent
              walletId={editWalletId}
              onDone={() => {
                setWalletStep("list");
                setEditWalletId(null);
              }}
              onRemove={(walletId, kind) => {
                dismissWalletSwitcher();
                requestAnimationFrame(() => {
                  if (kind === "lightning") {
                    navigation.navigate("RemoveLightningWallet", { walletId });
                  } else {
                    navigation.navigate("RemoveWallet", { walletId });
                  }
                });
              }}
            />
          ) : null}

          {/* Stale step without payload — never leave a blank grabber sheet. */}
          {walletStep === "edit" && !editWalletId ? (
            <WalletSwitcherSheetContent
              onClose={dismissWalletSwitcher}
              onAddWallet={() => {
                setWalletStep("add");
              }}
              onEditWallet={(walletId) => {
                setEditWalletId(walletId);
                setWalletStep("edit");
              }}
              onConnectNode={() => {
                setNodeStatusPayload(null);
                setWalletStep("connect-menu");
              }}
            />
          ) : null}

          {walletStep === "add" ? (
            <AddWalletSheetContent
              open={addWalletOpen}
              onDone={() => {
                dismissWalletSwitcher();
                goHomeThen(() => {});
              }}
              onImportWallet={() => {
                setImportReturnStep("add");
                void getMnemonicSource().then((s) => {
                  setImportPasskeyNote(s === "passkey-prf");
                  setWalletStep("import");
                });
              }}
              onExitFlow={() => {
                setWalletStep("list");
              }}
            />
          ) : null}

          {walletStep === "import" ? (
            <RestoreWalletContent
              mode="seed"
              passkeyInstall={importPasskeyNote}
              embedded
              onDone={() => {
                dismissWalletSwitcher();
                goHomeThen(() => {});
              }}
            />
          ) : null}

          {walletStep === "connect-menu" ? (
            <ConnectNodeSheetContent
              onSelect={(dest) => {
                setWalletStep(
                  dest === "lndhub" ? "connect-lndhub" : "connect-btcpay",
                );
              }}
            />
          ) : null}

          {walletStep === "connect-lndhub" ? (
            <ConnectLndHubSheetContent
              open={lndHubOpen}
              onConnected={(payload) => {
                setNodeStatusPayload(payload);
                setWalletStep("connect-status");
              }}
            />
          ) : null}

          {walletStep === "connect-btcpay" ? (
            <ConnectBtcPaySheetContent
              open={btcPayOpen}
              onConnected={(payload) => {
                setNodeStatusPayload(payload);
                setWalletStep("connect-status");
              }}
            />
          ) : null}

          {walletStep === "connect-status" && nodeStatusPayload ? (
            <NodeStatusSheetContent
              payload={nodeStatusPayload}
              onDone={() => {
                dismissWalletSwitcher();
                goHomeThen(() => {});
              }}
            />
          ) : null}

          {walletStep === "connect-status" && !nodeStatusPayload ? (
            <ConnectNodeSheetContent
              onSelect={(dest) => {
                setWalletStep(
                  dest === "lndhub" ? "connect-lndhub" : "connect-btcpay",
                );
              }}
            />
          ) : null}
        </InteractiveBottomSheet>

        <FundsNoticeOverlay open={fundsSentOpen}>
          {fundsSentPayload ? (
            <FundsSentView
              amount={fundsSentPayload.amount}
              amountLabel={fundsSentPayload.amountLabel}
              txid={fundsSentPayload.txid}
              address={fundsSentPayload.address}
              recipientCount={fundsSentPayload.recipientCount}
              rail={fundsSentPayload.rail ?? "arkade"}
              onViewActivity={() => {
                const amount = fundsSentPayload.amount;
                const txid = fundsSentPayload.txid;
                const rail = fundsSentPayload.rail ?? "arkade";
                const walletId = selectedWallet?.id ?? null;
                dismissFundsSent();
                if (!walletId) {
                  goHomeThen(() => openActivity());
                  return;
                }
                const networkId = getNetworkConfig().id;
                const activityId =
                  findActivityIdByTxid(networkId, walletId, txid) ??
                  findRecentSendActivityId(networkId, walletId, amount, rail) ??
                  (txid.trim() ? txid.trim() : null);
                if (activityId) {
                  openActivityDetailFromHome(activityId, walletId);
                } else {
                  goHomeThen(() => openActivity());
                }
              }}
              onSaveToContacts={
                (fundsSentPayload.recipientCount == null ||
                  fundsSentPayload.recipientCount <= 1) &&
                fundsSentPayload.address &&
                !findContactByIdentifierValue(fundsSentPayload.address)
                  ? () => {
                      openSaveToContacts(fundsSentPayload.address!);
                    }
                  : undefined
              }
              onDone={onFundsSentDone}
            />
          ) : null}
        </FundsNoticeOverlay>

        <SaveToContactsSheet
          open={saveContactOpen}
          destination={saveContactDest}
          onDismiss={() => {
            setSaveContactOpen(false);
            setSaveContactDest("");
          }}
        />

        <InteractiveBottomSheet
          ref={fiatModeRef}
          open={fiatModeSheet != null}
          onDismiss={clearFiatModeSheet}
          // Fit-to-content anchored at bottom (Enter/Exit). Cap height so
          // intrinsic measure never expands to a tall empty void.
          visibleFraction={fiatModeSheet === "exit" ? 0.55 : 0.72}
          fitContent
        >
          {fiatModeSheet === "enter" ? (
            <FiatModeEnterSheetContent
              availableSats={balanceSats ?? 0}
              onConfirm={() => {
                dismissFiatModeSheet();
                void confirmEnter();
              }}
              onCancel={dismissFiatModeSheet}
            />
          ) : null}
          {fiatModeSheet === "exit" ? (
            <FiatModeExitSheetContent
              brlDisplay={depixDisplay ?? 0}
              onConfirm={() => {
                dismissFiatModeSheet();
                void (async () => {
                  const auth = await requireUserPresence("Confirm Exit Fiat Mode");
                  if (!auth.ok) return;
                  void confirmExit();
                })();
              }}
              onCancel={dismissFiatModeSheet}
            />
          ) : null}
        </InteractiveBottomSheet>

        <FundsNoticeOverlay open={fundsReceivedOpen}>
          {fundsReceivedPayload ? (
            <FundsReceivedView
              amount={fundsReceivedPayload.amount}
              kind={fundsReceivedPayload.kind}
              onViewDetails={() => {
                const amount = fundsReceivedPayload.amount;
                const kind = fundsReceivedPayload.kind;
                const walletId = selectedWallet?.id ?? null;
                dismissFundsReceived();
                if (!walletId) {
                  goHomeThen(() => {});
                  return;
                }
                const networkId = getNetworkConfig().id;
                const activityId = findRecentReceiveActivityId(
                  networkId,
                  walletId,
                  amount,
                  kind,
                );
                if (activityId) {
                  openActivityDetailFromHome(activityId, walletId);
                } else {
                  goHomeThen(() => openActivity());
                }
              }}
              onDone={onFundsReceivedDone}
            />
          ) : null}
        </FundsNoticeOverlay>
      </View>
    </SheetContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
});
