/**
 * BLE advertise/scan transport for Basic pair (chunked manufacturer data).
 * Uses react-native-ble-advertiser — no plaintext secrets on the air.
 *
 * Advertise uses manufacturer data only in the primary AD (≤31 bytes). Service
 * UUID is in the scan response (patched native). Scan filters by company ID.
 */

import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";
import BLEAdvertiser from "react-native-ble-advertiser";
import {
  assembleChunks,
  BASIC_PAIR_COMPANY_ID,
  BASIC_PAIR_SERVICE_UUID,
  chunkBytes,
  decodePairFrame,
  encodePairFrame,
  FRAME_PAYLOAD_MAX,
  hash8Equal,
  MSG_CIPHER,
  MSG_HELLO,
  type PairFrame,
} from "./pairProtocol";

const PAIR_WINDOW_MS = 3 * 60 * 1000;
/** Slow enough that stop/restart advertise on MIUI can settle between frames. */
const BROADCAST_ROTATE_MS = 280;

type DeviceFoundEvent = {
  manufData?: number[];
  companyId?: number;
  rssi?: number;
};

function emitter(): NativeEventEmitter {
  return new NativeEventEmitter(NativeModules.BLEAdvertiser);
}

function androidApiLevel(): number {
  if (typeof Platform.Version === "number") return Platform.Version;
  const n = parseInt(String(Platform.Version), 10);
  return Number.isFinite(n) ? n : 30;
}

function isGranted(status: string | undefined): boolean {
  return status === PermissionsAndroid.RESULTS.GRANTED || status === "granted";
}

/**
 * Request runtime BLE permissions so scan/advertise can prompt the OS dialog.
 * Android 12+: SCAN / ADVERTISE / CONNECT. Older: fine/coarse location.
 */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const api = androidApiLevel();
  const wanted =
    api >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ];

  const missing: string[] = [];
  for (const perm of wanted) {
    try {
      const ok = await PermissionsAndroid.check(perm);
      if (!ok) missing.push(perm);
    } catch {
      missing.push(perm);
    }
  }
  if (missing.length === 0) return true;

  try {
    const result = await PermissionsAndroid.requestMultiple(
      missing as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][],
    );
    return missing.every((perm) =>
      isGranted(result[perm as keyof typeof result]),
    );
  } catch {
    return false;
  }
}

async function prepareAdapter(): Promise<void> {
  BLEAdvertiser.setCompanyId(BASIC_PAIR_COMPANY_ID);
  try {
    const state = await BLEAdvertiser.getAdapterState();
    if (String(state).toUpperCase().includes("OFF")) {
      BLEAdvertiser.enableAdapter();
    }
  } catch {
    /* best-effort */
  }
}

async function stopAllBle(): Promise<void> {
  try {
    await BLEAdvertiser.stopBroadcast();
  } catch {
    /* ok */
  }
  try {
    await BLEAdvertiser.stopScan();
  } catch {
    /* ok */
  }
}

/** Open BLE scan; JS filters on Basic frame magic + company manuf data. */
function startCompanyScan(): Promise<string> {
  // Empty manuf array → native opens an unfiltered scan (see ble-advertiser patch).
  return BLEAdvertiser.scan([], {
    scanMode: BLEAdvertiser.SCAN_MODE_LOW_LATENCY ?? 2,
    matchMode: BLEAdvertiser.MATCH_MODE_AGGRESSIVE ?? 1,
    numberOfMatches: BLEAdvertiser.MATCH_NUM_MAX_ADVERTISEMENT ?? 3,
    reportDelay: 0,
  });
}

function rotateBroadcast(
  frames: number[][],
  signal: { cancelled: boolean },
  onError?: (msg: string) => void,
): { stop: () => void } {
  let i = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let advertiseFailed = false;

  const tick = () => {
    if (signal.cancelled || advertiseFailed) return;
    const data = frames[i % frames.length]!;
    i += 1;
    void BLEAdvertiser.broadcast(BASIC_PAIR_SERVICE_UUID, data, {
      advertiseMode: BLEAdvertiser.ADVERTISE_MODE_LOW_LATENCY ?? 2,
      txPowerLevel: BLEAdvertiser.ADVERTISE_TX_POWER_HIGH ?? 3,
      connectable: false,
      includeDeviceName: false,
      includeTxPowerLevel: false,
    }).catch((e: unknown) => {
      if (signal.cancelled) return;
      const msg = e instanceof Error ? e.message : String(e);
      // DATA_TOO_LARGE / unavailable — stop thrashing and surface once.
      if (/too large|unavailable|not supported|Invalid company/i.test(msg)) {
        advertiseFailed = true;
        onError?.(msg);
      }
    });
  };

  tick();
  timer = setInterval(tick, BROADCAST_ROTATE_MS);
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

function framesForMessage(
  msgType: number,
  lobbyHash8: Uint8Array,
  payload: Uint8Array,
): number[][] {
  const chunks = chunkBytes(payload, FRAME_PAYLOAD_MAX);
  const total = chunks.length;
  return chunks.map((payloadChunk, seq) =>
    encodePairFrame({
      msgType,
      lobbyHash8,
      seq,
      total,
      payload: payloadChunk,
    }),
  );
}

/**
 * Device 2: advertise HELLO (pub) while scanning for CIPHER reply with same lobby hash.
 */
export async function runRequesterBleSession(input: {
  lobbyHash8: Uint8Array;
  pubCompressed: Uint8Array;
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const ok = await ensureBlePermissions();
  if (!ok) throw new Error("Bluetooth permission required");
  await prepareAdapter();
  await stopAllBle();

  const helloFrames = framesForMessage(MSG_HELLO, input.lobbyHash8, input.pubCompressed);
  const local = { cancelled: false };
  const onAbort = () => {
    local.cancelled = true;
  };
  input.signal?.addEventListener("abort", onAbort);

  const parts = new Map<number, Uint8Array>();

  return new Promise<Uint8Array>((resolve, reject) => {
    let cleaned = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let sub: { remove: () => void } | undefined;
    let rotator: { stop: () => void } | undefined;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      local.cancelled = true;
      if (timeout) clearTimeout(timeout);
      sub?.remove();
      rotator?.stop();
      input.signal?.removeEventListener("abort", onAbort);
      void stopAllBle();
    };

    rotator = rotateBroadcast(helloFrames, local, (err) => {
      cleanup();
      reject(new Error(`Bluetooth advertise failed: ${err}`));
    });
    input.onStatus?.("Waiting for nearby device…");

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Pairing timed out. Try again with devices close together."));
    }, PAIR_WINDOW_MS);

    sub = emitter().addListener("onDeviceFound", (device: DeviceFoundEvent) => {
      if (local.cancelled) return;
      if (!device.manufData?.length) return;
      const frame = decodePairFrame(device.manufData);
      if (!frame || frame.msgType !== MSG_CIPHER) return;
      if (!hash8Equal(frame.lobbyHash8, input.lobbyHash8)) return;
      parts.set(frame.seq, frame.payload);
      input.onStatus?.(`Receiving… ${parts.size}/${frame.total}`);
      const assembled = assembleChunks(frame.total, parts);
      if (!assembled) return;
      cleanup();
      resolve(assembled);
    });

    void startCompanyScan().catch((e: unknown) => {
      cleanup();
      reject(e instanceof Error ? e : new Error("BLE scan failed"));
    });
  });
}

/**
 * Device 1: scan HELLO, return requester pub + lobby hash; caller encrypts then sendCipherReply.
 */
export async function scanRequesterHello(input: {
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<{ pubCompressed: Uint8Array; lobbyHash8: Uint8Array }> {
  const ok = await ensureBlePermissions();
  if (!ok) throw new Error("Bluetooth permission required");
  await prepareAdapter();
  await stopAllBle();

  const local = { cancelled: false };
  const onAbort = () => {
    local.cancelled = true;
  };
  input.signal?.addEventListener("abort", onAbort);

  const parts = new Map<number, Uint8Array>();
  let lobbyHash8: Uint8Array | null = null;

  input.onStatus?.("Scanning for nearby Basic…");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("No nearby device found. Open Basic onboarding on the other phone."));
    }, PAIR_WINDOW_MS);

    const sub = emitter().addListener("onDeviceFound", (device: DeviceFoundEvent) => {
      if (local.cancelled) return;
      if (!device.manufData?.length) return;
      const frame = decodePairFrame(device.manufData);
      if (!frame || frame.msgType !== MSG_HELLO) return;
      if (!lobbyHash8) lobbyHash8 = frame.lobbyHash8;
      else if (!hash8Equal(lobbyHash8, frame.lobbyHash8)) return;
      parts.set(frame.seq, frame.payload);
      input.onStatus?.(`Found device… ${parts.size}/${frame.total}`);
      const assembled = assembleChunks(frame.total, parts);
      if (!assembled || !lobbyHash8) return;
      cleanup();
      resolve({ pubCompressed: assembled, lobbyHash8 });
    });

    void startCompanyScan().catch((e: unknown) => {
      cleanup();
      reject(e instanceof Error ? e : new Error("BLE scan failed"));
    });

    function cleanup() {
      local.cancelled = true;
      clearTimeout(timeout);
      sub.remove();
      input.signal?.removeEventListener("abort", onAbort);
      void stopAllBle();
    }
  });
}

/** Device 1: advertise CIPHER chunks for ~window so Device 2 can reassemble. */
export async function broadcastCipherReply(input: {
  lobbyHash8: Uint8Array;
  wireBytes: Uint8Array;
  durationMs?: number;
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  await prepareAdapter();
  await stopAllBle();

  const frames = framesForMessage(MSG_CIPHER, input.lobbyHash8, input.wireBytes);
  const local = { cancelled: false };
  const onAbort = () => {
    local.cancelled = true;
  };
  input.signal?.addEventListener("abort", onAbort);

  let advertiseError: Error | null = null;
  const rotator = rotateBroadcast(frames, local, (err) => {
    advertiseError = new Error(`Bluetooth advertise failed: ${err}`);
    local.cancelled = true;
  });
  input.onStatus?.("Sending encrypted login…");

  const duration = input.durationMs ?? Math.min(PAIR_WINDOW_MS, Math.max(8_000, frames.length * BROADCAST_ROTATE_MS * 3));

  await new Promise<void>((resolve) => {
    const t = setTimeout(() => resolve(), duration);
    input.signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

  local.cancelled = true;
  rotator.stop();
  input.signal?.removeEventListener("abort", onAbort);
  await stopAllBle();
  if (advertiseError) throw advertiseError;
}

export async function cancelPairBle(): Promise<void> {
  await stopAllBle();
}

/** Re-export frame type for tests. */
export type { PairFrame };
