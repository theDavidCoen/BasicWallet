/**
 * Active Arkade network: persisted prefs (network id + optional custom ASP).
 * Call loadNetworkPreferences() at boot before WalletProvider.
 * @see prototype/docs/ux-ui-spec.md §0
 */

import type { ArkadeNetworkId, NetworkConfig } from "./networkDefaults";
import { getNetworkPrefs, resolveNetworkConfig } from "./networkPrefs";

export type { ArkadeNetworkId, NetworkConfig } from "./networkDefaults";
export { NETWORK_DEFAULTS } from "./networkDefaults";

/** Current network from loaded prefs (defaults to mainnet until load). */
export function getNetworkConfig(): NetworkConfig {
  return resolveNetworkConfig(getNetworkPrefs());
}
