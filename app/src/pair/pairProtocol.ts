/**
 * Bluetooth fast-login crypto + frame codec.
 * Ephemeral secp256k1 ECDH → HKDF → AES-256-GCM.
 * Cleartext on air: lobbyId / pubs / ciphertext only (never nsec or seeds).
 */

import { gcm } from "@noble/ciphers/aes.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import * as Crypto from "expo-crypto";

/** Stable service UUID for Basic BLE pair advertise/scan. */
export const BASIC_PAIR_SERVICE_UUID = "ba51c001-0000-4000-8000-00805f9b34fb";

/** Manufacturer company id (Bluetooth SIG unassigned range for app use). */
export const BASIC_PAIR_COMPANY_ID = 0x0ba5;

const MAGIC0 = 0x42; // B
const MAGIC1 = 0x50; // P
const FRAME_VERSION = 1;
export const MSG_HELLO = 0x01;
export const MSG_CIPHER = 0x02;

const HKDF_INFO = utf8ToBytes("basic.wallet.ble.pair.v1");
const IV_LEN = 12;

export type PairEphemeralKeypair = {
  sk: Uint8Array;
  /** Compressed SEC1 public key (33 bytes). */
  pubCompressed: Uint8Array;
  lobbyId: string;
  lobbyHash8: Uint8Array;
};

export type PairWireEnvelope = {
  /** Approver ephemeral compressed pub. */
  approverPubHex: string;
  /** AES-GCM ciphertext (includes auth tag). */
  ciphertextHex: string;
};

export function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

/** lobbyId = Base58(SHA256(SHA256(pub))[0:10]). */
export function lobbyIdFromPub(pubCompressed: Uint8Array): string {
  const digest = doubleSha256(pubCompressed);
  return base58.encode(digest.slice(0, 10));
}

export function lobbyHash8FromPub(pubCompressed: Uint8Array): Uint8Array {
  return doubleSha256(pubCompressed).slice(0, 8);
}

export function lobbyIdsMatch(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

export function verifyLobbyBind(pubCompressed: Uint8Array, lobbyId: string): boolean {
  return lobbyIdsMatch(lobbyIdFromPub(pubCompressed), lobbyId);
}

export async function generatePairEphemeralKeypair(): Promise<PairEphemeralKeypair> {
  const sk = secp256k1.utils.randomSecretKey();
  const pubCompressed = secp256k1.getPublicKey(sk, true);
  return {
    sk,
    pubCompressed,
    lobbyId: lobbyIdFromPub(pubCompressed),
    lobbyHash8: lobbyHash8FromPub(pubCompressed),
  };
}

function randomBytes(len: number): Uint8Array {
  return Crypto.getRandomBytes(len);
}

/** Shared AES-256 key from ECDH(sk, peerPub). */
export function derivePairAesKey(sk: Uint8Array, peerPubCompressed: Uint8Array): Uint8Array {
  const shared = secp256k1.getSharedSecret(sk, peerPubCompressed, true);
  // Drop leading parity byte from compressed shared point → 32-byte x only if present.
  const ikm = shared.length === 33 ? shared.slice(1) : shared;
  return hkdf(sha256, ikm, undefined, HKDF_INFO, 32);
}

export function encryptPairPayload(
  plaintext: Uint8Array,
  requesterPubCompressed: Uint8Array,
): { approverSk: Uint8Array; approverPubCompressed: Uint8Array; envelope: PairWireEnvelope } {
  const approverSk = secp256k1.utils.randomSecretKey();
  const approverPubCompressed = secp256k1.getPublicKey(approverSk, true);
  const key = derivePairAesKey(approverSk, requesterPubCompressed);
  const iv = randomBytes(IV_LEN);
  const aes = gcm(key, iv);
  const ct = aes.encrypt(plaintext);
  // Prepend IV to ciphertext for wire (single blob).
  const wire = new Uint8Array(iv.length + ct.length);
  wire.set(iv, 0);
  wire.set(ct, iv.length);
  return {
    approverSk,
    approverPubCompressed,
    envelope: {
      approverPubHex: bytesToHex(approverPubCompressed),
      ciphertextHex: bytesToHex(wire),
    },
  };
}

export function decryptPairPayload(
  envelope: PairWireEnvelope,
  requesterSk: Uint8Array,
): Uint8Array {
  const approverPub = hexToBytes(envelope.approverPubHex);
  const wire = hexToBytes(envelope.ciphertextHex);
  if (wire.length <= IV_LEN) throw new Error("Ciphertext too short");
  const iv = wire.slice(0, IV_LEN);
  const ct = wire.slice(IV_LEN);
  const key = derivePairAesKey(requesterSk, approverPub);
  const aes = gcm(key, iv);
  return aes.decrypt(ct);
}

/** Bytes available for payload after fixed frame header (company-data only). */
export const FRAME_HEADER_LEN = 14; // magic2+ver+type+hash8+seq+total
export const FRAME_PAYLOAD_MAX = 14; // keep AD under typical 31-byte limit with company id

export type PairFrame = {
  msgType: number;
  lobbyHash8: Uint8Array;
  seq: number;
  total: number;
  payload: Uint8Array;
};

export function encodePairFrame(frame: PairFrame): number[] {
  if (frame.lobbyHash8.length !== 8) throw new Error("lobbyHash8 must be 8 bytes");
  if (frame.payload.length > FRAME_PAYLOAD_MAX) throw new Error("Frame payload too large");
  const out = new Uint8Array(FRAME_HEADER_LEN + frame.payload.length);
  out[0] = MAGIC0;
  out[1] = MAGIC1;
  out[2] = FRAME_VERSION;
  out[3] = frame.msgType & 0xff;
  out.set(frame.lobbyHash8, 4);
  out[12] = frame.seq & 0xff;
  out[13] = frame.total & 0xff;
  out.set(frame.payload, FRAME_HEADER_LEN);
  return Array.from(out);
}

export function decodePairFrame(manufData: number[] | Uint8Array): PairFrame | null {
  const bytes =
    manufData instanceof Uint8Array ? manufData : Uint8Array.from(manufData);
  if (bytes.length < FRAME_HEADER_LEN) return null;
  if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) return null;
  if (bytes[2] !== FRAME_VERSION) return null;
  const msgType = bytes[3]!;
  if (msgType !== MSG_HELLO && msgType !== MSG_CIPHER) return null;
  const lobbyHash8 = bytes.slice(4, 12);
  const seq = bytes[12]!;
  const total = bytes[13]!;
  if (total < 1 || seq >= total) return null;
  return {
    msgType,
    lobbyHash8,
    seq,
    total,
    payload: bytes.slice(FRAME_HEADER_LEN),
  };
}

export function chunkBytes(data: Uint8Array, chunkSize = FRAME_PAYLOAD_MAX): Uint8Array[] {
  if (data.length === 0) return [new Uint8Array(0)];
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    out.push(data.slice(i, i + chunkSize));
  }
  return out;
}

export function assembleChunks(
  total: number,
  parts: Map<number, Uint8Array>,
): Uint8Array | null {
  if (parts.size < total) return null;
  let len = 0;
  for (let i = 0; i < total; i++) {
    const p = parts.get(i);
    if (!p) return null;
    len += p.length;
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < total; i++) {
    const p = parts.get(i)!;
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function encodeWireEnvelope(env: PairWireEnvelope): Uint8Array {
  return utf8ToBytes(JSON.stringify(env));
}

export function decodeWireEnvelope(raw: Uint8Array): PairWireEnvelope {
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as PairWireEnvelope;
  if (
    typeof parsed.approverPubHex !== "string" ||
    typeof parsed.ciphertextHex !== "string" ||
    !parsed.approverPubHex ||
    !parsed.ciphertextHex
  ) {
    throw new Error("Invalid pair envelope");
  }
  return parsed;
}

export function hash8Equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
