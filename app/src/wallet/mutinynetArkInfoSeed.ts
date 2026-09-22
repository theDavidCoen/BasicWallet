/**
 * Bundled mutinynet ArkInfo snapshot so Wallet.create can open offline / when
 * getInfo hangs on device (SDK falls back via ProviderUnavailableError).
 *
 * Source: GET https://mutinynet.arkade.sh/v1/info (2026-09-16).
 * Refresh if signer keys / delays change on the public mutinynet server.
 */

export const MUTINYNET_ARK_INFO_SNAPSHOT = {
  version: 1 as const,
  savedAt: 1_726_500_000_000,
  source: "arkade.getInfo" as const,
  arkInfo: {
    network: "mutinynet",
    signerPubkey:
      "03301078808e4f7bc0dadfe29e34b1df8eaf0108ef06b1722274075ebc107a127a",
    forfeitPubkey:
      "02dfcaec558c7e78cf3e38b898ba8a43cfb5727266bae32c5c5b3aeb32c558aa0b",
    forfeitAddress: "tb1qz5zgustrxzztljhfr5pm8s4m0a4v0pzqzct90v",
    checkpointTapscript:
      "03080040b27520dfcaec558c7e78cf3e38b898ba8a43cfb5727266bae32c5c5b3aeb32c558aa0bac",
    unilateralExitDelay: "2048",
    boardingExitDelay: "604672",
    sessionDuration: "60",
    dust: "330",
    vtxoMinAmount: "1",
    vtxoMaxAmount: "-1",
    utxoMinAmount: "330",
    utxoMaxAmount: "-1",
    maxTxWeight: "40000",
    maxOpReturnOutputs: "3",
    digest: "2e14a884689aba877ecdf423a61862f01b9627927e65cccf119c2aee48fdf4d9",
    version: "",
    fees: {
      intentFee: {
        offchainInput: "0.0",
        offchainOutput: "0.0",
        onchainInput: "0.0",
        onchainOutput: "0.0",
      },
      txFeeRate: "0",
    },
    deprecatedSigners: [
      {
        pubkey:
          "03fa73c6e4876ffb2dfc961d763cca9abc73d4b88efcb8f5e7ff92dc55e9aa553d",
        cutoffDate: "1782000000",
      },
    ],
  },
};
