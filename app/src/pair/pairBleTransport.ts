/**
 * BLE advertise/scan transport for Basic pair (chunked manufacturer data).
 * Uses react-native-ble-advertiser — no plaintext secrets on the air.
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
const BROADCAST_ROTATE_MS = 80;

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

function rotateBroadcast(
  frames: number[][],
  signal: { cancelled: boolean },
): { stop: () => void } {
  let i = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    if (signal.cancelled) return;
    const data = frames[i % frames.length]!;
    i += 1;
    void BLEAdvertiser.broadcast(BASIC_PAIR_SERVICE_UUID, data, {
      advertiseMode: BLEAdvertiser.ADVERTISE_MODE_LOW_LATENCY ?? 2,
      txPowerLevel: BLEAdvertiser.ADVERTISE_TX_POWER_HIGH ?? 3,
      connectable: false,
      includeDeviceName: false,
      includeTxPowerLevel: false,
    }).catch(() => {
      /* transient */
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

  const rotator = rotateBroadcast(helloFrames, local);
  input.onStatus?.("Waiting for nearby device…");

  const parts = new Map<number, Uint8Array>();
  let expectedTotal: number | null = null;

  return new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Pairing timed out. Try again with devices close together."));
    }, PAIR_WINDOW_MS);

    const sub = emitter().addListener("onDeviceFound", (device: DeviceFoundEvent) => {
      if (local.cancelled) return;
      if (!device.manufData?.length) return;
      const frame = decodePairFrame(device.manufData);
      if (!frame || frame.msgType !== MSG_CIPHER) return;
      if (!hash8Equal(frame.lobbyHash8, input.lobbyHash8)) return;
      expectedTotal = frame.total;
      parts.set(frame.seq, frame.payload);
      input.onStatus?.(`Receiving… ${parts.size}/${frame.total}`);
      const assembled = assembleChunks(frame.total, parts);
      if (!assembled) return;
      cleanup();
      resolve(assembled);
    });

    void BLEAdvertiser.scanByService(BASIC_PAIR_SERVICE_UUID, {
      scanMode: BLEAdvertiser.SCAN_MODE_LOW_LATENCY ?? 2,
      matchMode: BLEAdvertiser.MATCH_MODE_AGGRESSIVE ?? 1,
      numberOfMatches: BLEAdvertiser.MATCH_NUM_MAX_ADVERTISEMENT ?? 3,
      reportDelay: 0,
    }).catch((e: unknown) => {
      cleanup();
      reject(e instanceof Error ? e : new Error("BLE scan failed"));
    });

    function cleanup() {
      local.cancelled = true;
      clearTimeout(timeout);
      sub.remove();
      rotator.stop();
      input.signal?.removeEventListener("abort", onAbort);
      void stopAllBle();
    }
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

    void BLEAdvertiser.scanByService(BASIC_PAIR_SERVICE_UUID, {
      scanMode: BLEAdvertiser.SCAN_MODE_LOW_LATENCY ?? 2,
      matchMode: BLEAdvertiser.MATCH_MODE_AGGRESSIVE ?? 1,
      numberOfMatches: BLEAdvertiser.MATCH_NUM_MAX_ADVERTISEMENT ?? 3,
      reportDelay: 0,
    }).catch((e: unknown) => {
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

  const rotator = rotateBroadcast(frames, local);
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
}

export async function cancelPairBle(): Promise<void> {
  await stopAllBle();
}

/** Re-export frame type for tests. */
export type { PairFrame };
