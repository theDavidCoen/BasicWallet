/**
 * Official Arkade network defaults (ASP + Esplora).
 * Active selection + custom ASP: see networkPrefs.ts / getNetworkConfig().
 */

export type ArkadeNetworkId = "mutinynet" | "mainnet";

export type NetworkConfig = {
  id: ArkadeNetworkId;
  label: string;
  arkServerUrl: string;
  esploraUrl: string;
  isMainnet: boolean;
};

export const NETWORK_DEFAULTS: Record<ArkadeNetworkId, NetworkConfig> = {
  mutinynet: {
    id: "mutinynet",
    label: "Mutinynet",
    arkServerUrl: "https://mutinynet.arkade.sh",
    esploraUrl: "https://mutinynet.com/api",
    isMainnet: false,
  },
  mainnet: {
    id: "mainnet",
    label: "Bitcoin mainnet",
    arkServerUrl: "https://arkade.computer",
    esploraUrl: "https://mempool.space/api",
    isMainnet: true,
  },
};
