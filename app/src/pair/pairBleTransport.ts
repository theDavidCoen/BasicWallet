/**
 * BLE GATT transport for Basic pair.
 * Device 2 hosts a GATT server (native); Device 1 connects via react-native-ble-plx,
 * reads lobby pub, writes ciphertext chunks (large MTU), waits for ACK after apply.
 */

import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";
import { BleError, BleManager, Device, State } from "react-native-ble-plx";
import {
  assembleChunks,
  base64ToBytes,
  BASIC_PAIR_ACK_UUID,
  BASIC_PAIR_CIPHER_UUID,
  BASIC_PAIR_LOBBY_UUID,
  BASIC_PAIR_SERVICE_UUID,
  bytesToBase64,
  chunkBytes,
  decodeAckPayload,
  decodeGattChunk,
  encodeGattChunk,
  GATT_CHUNK_PAYLOAD_DEFAULT,
  GATT_CHUNK_PAYLOAD_LARGE,
  lobbyHash8FromPub,
} from "./pairProtocol";

const PAIR_WINDOW_MS = 3 * 60 * 1000;
const SCAN_TIMEOUT_MS = 90_000;
const ACK_TIMEOUT_MS = 60_000;

type NativeGatt = {
  startServer: (lobbyValueBase64: string) => Promise<boolean>;
  sendAck: (ok: boolean, message: string | null) => Promise<boolean>;
  stopServer: () => Promise<boolean>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

function nativeGatt(): NativeGatt {
  const mod = NativeModules.BasicPairGattServer as NativeGatt | undefined;
  if (!mod) {
    throw new Error(
      "Bluetooth GATT server is unavailable on this build. Reinstall the latest Basic APK.",
    );
  }
  return mod;
}

let bleManager: BleManager | null = null;

function manager(): BleManager {
  if (!bleManager) bleManager = new BleManager();
  return bleManager;
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
 * Request runtime BLE permissions so scan/advertise/connect can prompt the OS dialog.
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
    return missing.every((perm) => isGranted(result[perm as keyof typeof result]));
  } catch {
    return false;
  }
}

async function waitForPoweredOn(timeoutMs = 15_000): Promise<void> {
  const m = manager();
  const current = await m.state();
  if (current === State.PoweredOn) return;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      sub.remove();
      reject(new Error("Bluetooth is off. Turn it on and try again."));
    }, timeoutMs);
    const sub = m.onStateChange((state) => {
      if (state === State.PoweredOn) {
        clearTimeout(t);
        sub.remove();
        resolve();
      }
    }, true);
  });
}

/** Open session returned after Device 1 connects and reads the lobby pub. */
export type ApproverBleSession = {
  deviceId: string;
  pubCompressed: Uint8Array;
  lobbyHash8: Uint8Array;
  /** Disconnect + stop scan without sending. */
  cancel: () => Promise<void>;
  /** Encrypt caller builds wire; this writes chunks and waits for Device 2 ACK. */
  sendCipherAndWaitAck: (input: {
    wireBytes: Uint8Array;
    onStatus?: (msg: string) => void;
    signal?: AbortSignal;
  }) => Promise<void>;
};

/**
 * Device 2: host GATT server with lobby pub; assemble CIPHER writes; caller decrypts/applies then sendRequesterAck.
 */
export async function runRequesterBleSession(input: {
  lobbyHash8: Uint8Array;
  pubCompressed: Uint8Array;
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  if (Platform.OS !== "android") {
    throw new Error("Bluetooth pairing is currently Android-only.");
  }
  const ok = await ensureBlePermissions();
  if (!ok) throw new Error("Bluetooth permission required");

  const gatt = nativeGatt();
  await gatt.stopServer().catch(() => undefined);
  await gatt.startServer(bytesToBase64(input.pubCompressed));

  const emitter = new NativeEventEmitter(NativeModules.BasicPairGattServer);
  const parts = new Map<number, Uint8Array>();
  let expectedTotal: number | null = null;

  return new Promise<Uint8Array>((resolve, reject) => {
    let cleaned = false;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Pairing timed out. Try again with devices close together."));
    }, PAIR_WINDOW_MS);

    const onAbort = () => {
      cleanup();
      reject(new Error("Pairing cancelled"));
    };
    input.signal?.addEventListener("abort", onAbort);

    const subs = [
      emitter.addListener("BasicPairGatt_onAdvertiseError", (ev: { errorCode?: number }) => {
        cleanup();
        reject(new Error(`Bluetooth advertise failed (code ${ev?.errorCode ?? "?"})`));
      }),
      emitter.addListener("BasicPairGatt_onAdvertising", () => {
        input.onStatus?.("Waiting for nearby device…");
      }),
      emitter.addListener("BasicPairGatt_onConnected", () => {
        input.onStatus?.("Connected. Waiting for encrypted login…");
      }),
      emitter.addListener("BasicPairGatt_onCipherWrite", (ev: { dataBase64?: string }) => {
        if (cleaned || !ev?.dataBase64) return;
        try {
          const raw = base64ToBytes(ev.dataBase64);
          const chunk = decodeGattChunk(raw);
          if (!chunk) return;
          if (expectedTotal == null) expectedTotal = chunk.total;
          else if (chunk.total !== expectedTotal) return;
          parts.set(chunk.seq, chunk.payload);
          input.onStatus?.(`Receiving… ${parts.size}/${chunk.total}`);
          const assembled = assembleChunks(chunk.total, parts);
          if (!assembled) return;
          cleanup(false);
          resolve(assembled);
        } catch (e) {
          cleanup();
          reject(e instanceof Error ? e : new Error("Failed to parse login chunks"));
        }
      }),
    ];

    input.onStatus?.("Waiting for nearby device…");

    function cleanup(stopServer = true) {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      for (const s of subs) s.remove();
      if (stopServer) void gatt.stopServer().catch(() => undefined);
    }
  });
}

/** Device 2: notify Device 1 after decrypt+apply (or failure). Stops the GATT server. */
export async function sendRequesterAck(ok: boolean, message?: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const gatt = nativeGatt();
  try {
    await gatt.sendAck(ok, message ?? null);
    // Brief pause so the central can receive the notification before we tear down.
    await new Promise((r) => setTimeout(r, 400));
  } finally {
    await gatt.stopServer().catch(() => undefined);
  }
}

/**
 * Device 1: scan Basic pair service, connect, read lobby pub. Connection stays open for approve → send.
 */
export async function scanRequesterHello(input: {
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<ApproverBleSession> {
  const ok = await ensureBlePermissions();
  if (!ok) throw new Error("Bluetooth permission required");
  await waitForPoweredOn();

  const m = manager();
  input.onStatus?.("Scanning for nearby Basic…");

  const device = await new Promise<Device>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish();
      reject(new Error("No nearby device found. Open Basic onboarding on the other phone."));
    }, SCAN_TIMEOUT_MS);

    const onAbort = () => {
      finish();
      reject(new Error("Pairing cancelled"));
    };
    input.signal?.addEventListener("abort", onAbort);

    const sub = m.startDeviceScan(
      [BASIC_PAIR_SERVICE_UUID],
      { allowDuplicates: false },
      (error: BleError | null, scanned: Device | null) => {
        if (settled) return;
        if (error) {
          finish();
          reject(new Error(error.message || "BLE scan failed"));
          return;
        }
        if (!scanned) return;
        finish();
        resolve(scanned);
      },
    );

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      try {
        m.stopDeviceScan();
      } catch {
        /* ok */
      }
      void sub;
    }
  });

  if (input.signal?.aborted) {
    throw new Error("Pairing cancelled");
  }

  input.onStatus?.("Connecting…");
  let connected = await device.connect({ autoConnect: false, timeout: 15_000 });
  connected = await connected.discoverAllServicesAndCharacteristics();

  let mtu = 23;
  try {
    connected = await connected.requestMTU(512);
    mtu = connected.mtu ?? 512;
  } catch {
    mtu = connected.mtu ?? 23;
  }

  input.onStatus?.("Reading pairing code…");
  const lobbyChar = await connected.readCharacteristicForService(
    BASIC_PAIR_SERVICE_UUID,
    BASIC_PAIR_LOBBY_UUID,
  );
  if (!lobbyChar.value) throw new Error("Nearby device sent an empty pairing key");
  const pubCompressed = base64ToBytes(lobbyChar.value);
  if (pubCompressed.length !== 33) {
    throw new Error("Invalid pairing key from nearby device");
  }
  const lobbyHash8 = lobbyHash8FromPub(pubCompressed);

  // Subscribe to ACK early so Device 2 can notify after apply (may arrive before we wait).
  let ackResolve: ((v: { ok: boolean; message: string }) => void) | null = null;
  let ackReject: ((e: Error) => void) | null = null;
  let pendingAck: { ok: boolean; message: string } | null = null;

  const ackSub = connected.monitorCharacteristicForService(
    BASIC_PAIR_SERVICE_UUID,
    BASIC_PAIR_ACK_UUID,
    (error, characteristic) => {
      if (error) {
        const rej = ackReject;
        ackReject = null;
        rej?.(new Error(error.message || "ACK monitor failed"));
        return;
      }
      if (!characteristic?.value) return;
      const decoded = decodeAckPayload(base64ToBytes(characteristic.value));
      if (ackResolve) {
        const res = ackResolve;
        ackResolve = null;
        ackReject = null;
        res(decoded);
      } else {
        pendingAck = decoded;
      }
    },
  );

  const sessionDeviceId = connected.id;
  let cancelled = false;

  const cancel = async () => {
    cancelled = true;
    try {
      ackSub.remove();
    } catch {
      /* ok */
    }
    try {
      await manager().cancelDeviceConnection(sessionDeviceId);
    } catch {
      /* ok */
    }
  };

  input.signal?.addEventListener("abort", () => {
    void cancel();
  });

  const sendCipherAndWaitAck = async (sendInput: {
    wireBytes: Uint8Array;
    onStatus?: (msg: string) => void;
    signal?: AbortSignal;
  }) => {
    if (cancelled || sendInput.signal?.aborted) throw new Error("Pairing cancelled");

    const payloadMax =
      mtu >= 100 ? GATT_CHUNK_PAYLOAD_LARGE : Math.max(GATT_CHUNK_PAYLOAD_DEFAULT, mtu - 7);
    const chunks = chunkBytes(sendInput.wireBytes, payloadMax);
    const total = chunks.length;
    sendInput.onStatus?.(`Sending encrypted login… 0/${total}`);

    for (let seq = 0; seq < total; seq++) {
      if (cancelled || sendInput.signal?.aborted) throw new Error("Pairing cancelled");
      const frame = encodeGattChunk(seq, total, chunks[seq]!);
      await manager().writeCharacteristicWithResponseForDevice(
        sessionDeviceId,
        BASIC_PAIR_SERVICE_UUID,
        BASIC_PAIR_CIPHER_UUID,
        bytesToBase64(frame),
      );
      sendInput.onStatus?.(`Sending encrypted login… ${seq + 1}/${total}`);
    }

    sendInput.onStatus?.("Waiting for the other phone to finish…");

    const ack = await new Promise<{ ok: boolean; message: string }>((resolve, reject) => {
      if (pendingAck) {
        const v = pendingAck;
        pendingAck = null;
        resolve(v);
        return;
      }
      const t = setTimeout(() => {
        ackResolve = null;
        ackReject = null;
        reject(new Error("The other phone did not confirm login. Try again."));
      }, ACK_TIMEOUT_MS);
      const onAbort = () => {
        clearTimeout(t);
        ackResolve = null;
        ackReject = null;
        reject(new Error("Pairing cancelled"));
      };
      sendInput.signal?.addEventListener("abort", onAbort);
      ackResolve = (v) => {
        clearTimeout(t);
        sendInput.signal?.removeEventListener("abort", onAbort);
        resolve(v);
      };
      ackReject = (e) => {
        clearTimeout(t);
        sendInput.signal?.removeEventListener("abort", onAbort);
        reject(e);
      };
    });

    try {
      ackSub.remove();
    } catch {
      /* ok */
    }
    try {
      await manager().cancelDeviceConnection(sessionDeviceId);
    } catch {
      /* ok */
    }

    if (!ack.ok) {
      throw new Error(ack.message || "The other phone failed to apply the login.");
    }
  };

  return {
    deviceId: sessionDeviceId,
    pubCompressed,
    lobbyHash8,
    cancel,
    sendCipherAndWaitAck,
  };
}

/** @deprecated Use ApproverBleSession.sendCipherAndWaitAck — kept so old imports fail loudly if misused. */
export async function broadcastCipherReply(): Promise<void> {
  throw new Error("broadcastCipherReply removed — use GATT sendCipherAndWaitAck");
}

export async function cancelPairBle(): Promise<void> {
  try {
    manager().stopDeviceScan();
  } catch {
    /* ok */
  }
  if (Platform.OS === "android") {
    try {
      await nativeGatt().stopServer();
    } catch {
      /* ok if module missing during metro */
    }
  }
}
