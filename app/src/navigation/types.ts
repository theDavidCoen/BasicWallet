import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

export type RootStackParamList = {
  OnboardingCreate: undefined;
  /** Recommend OS biometrics; require App PIN when biometrics are off. */
  OnboardingSecurity: { continueTo: "passkey" | "device-only" | "restore" };
  /** Passkey path = cross-device only; device-only = without passkey → Advanced Backup. */
  TermsOfUse: { mode: "passkey" | "device-only" | "dev-csprng" };
  /** Glow-style busy screen while Credential Manager / PRF / labels run. */
  PasskeyProgress: { mode: "detect" | "create" };
  AdvancedBackup: undefined;
  NostrBackup: undefined;
  HomeServerBackup: undefined;
  /** `seed` = Add Wallet (Arkade only). `full` = Settings / onboarding (seed | nsec | server). */
  RestoreWallet: { mode?: "full" | "seed" };
  Ready: undefined;
  Home: undefined;
  /** @deprecated Sheet host — kept for type compat; do not navigate. */
  WalletSwitcher: undefined;
  /** @deprecated Prefer Wallets sheet › edit step. */
  EditWallet: { walletId: string };
  RemoveWallet: { walletId: string };
  RemoveLightningWallet: { walletId: string };
  AddWallet: undefined;
  /** @deprecated Prefer sheet openImportWallet / Settings RestoreWallet. */
  Receive: undefined;
  Send: { to?: string; amountSats?: number } | undefined;
  Settings: undefined;
  /** Arkade-specific settings (network, delegates, recovery, exits) */
  ArkadeSettings: undefined;
  /** Arkade network + custom ASP */
  ArkadeNetwork: undefined;
  /** Penpot 05b */
  DisplayCurrencies: undefined;
  /** Bitcoin Maxi Mode (auto-swap inbound assets → sats) */
  BitcoinMaxiSettings: undefined;
  /** Fiat Mode (DePix / BRL) for selected Arkade wallet */
  FiatModeSettings: undefined;
  /** Arkade VTXO delegates */
  Delegates: undefined;
  /** Status for selected wallet (Arkade operator / Lightning node). Not the connect hub. */
  ConnectedNode: undefined;
  /** Penpot 06 — Connect Lightning Node hub (stack leftover; prefer Add Wallet sheet). */
  ConnectNode: undefined;
  /** Penpot 06b — BTCPay LND REST (stack from Settings; sheet step from switcher). */
  ConnectBtcPay: undefined;
  /** LNDHub (stack from Settings; sheet step from switcher). */
  ConnectLndHub: undefined;
  /** Penpot 13 — Node Status after connect */
  NodeStatus:
    | {
        localSats?: number;
        alias?: string;
        pubkey?: string;
      }
    | undefined;
  Privacy: undefined;
  SetAppPin:
    | {
        intent?: "set" | "change" | "remove" | "onboarding";
        continueTo?: "passkey" | "device-only" | "restore";
      }
    | undefined;
  ExportRecoveryPhrase: { walletId?: string } | undefined;
  NostrIdentity: undefined;
  ArchivedWallets: undefined;
  /** Private contacts directory */
  Contacts: undefined;
  ContactEdit: { contactId?: string } | undefined;
  /** Incoming Nostr contact share offer */
  ContactShareOffer: { offerId: string };
  ExportNsecWarning:
    | {
        /** After Path C enable — Done continues here instead of Nostr identity. */
        afterEnable?: "AdvancedBackup" | "Ready";
      }
    | undefined;
  ExportNsecReveal:
    | {
        afterEnable?: "AdvancedBackup" | "Ready";
      }
    | undefined;
  GenerateIdentityWarning: undefined;
  ImportNsecWarning: undefined;
  ResetApp: undefined;
  /** Session console / diagnostics export */
  Logs: undefined;
  /** Unilateral / collaborative exit hub */
  UnilateralExitHub: undefined;
  UnilateralExitPrepare: undefined;
  /** Step 3 — fund HD fee address */
  UnilateralExitFund:
    | {
        expectedRecoveredSats?: number;
        expectedFundingSats?: number;
      }
    | undefined;
  /** Step 4 — Start execute (last) */
  UnilateralExitExecute: { esploraUrl?: string } | undefined;
  CollaborativeOffboard: undefined;
  /** External onchain address for exit recovery / auto-prepare */
  ExitRecoveryAddress: { from?: "reminder" | "exit" } | undefined;
  /** Penpot 05f About */
  About: undefined;
  /** @deprecated Sheet host — do not navigate. */
  Activity: undefined;
  ActivityDetail: { activityId: string; walletId?: string };
  /** @deprecated Sheet host — do not navigate. */
  FundsReceived: { amount: number; kind: "boarding" | "arkade" | "lightning" | "brl" };
  /** @deprecated Sheet host — do not navigate. */
  FundsSent: {
    amount: number;
    txid: string;
    address?: string;
    recipientCount?: number;
    rail?: "arkade" | "lightning";
  };
};

export type RootNav = NativeStackNavigationProp<RootStackParamList>;
