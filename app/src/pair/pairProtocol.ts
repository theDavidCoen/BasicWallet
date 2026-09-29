/**
 * Bluetooth fast-login crypto + GATT chunk codec.
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

/** Stable service UUID for Basic BLE pair GATT. */
export const BASIC_PAIR_SERVICE_UUID = "ba51c001-0000-4000-8000-00805f9b34fb";
export const BASIC_PAIR_LOBBY_UUID = "ba51c001-0001-4000-8000-00805f9b34fb";
export const BASIC_PAIR_CIPHER_UUID = "ba51c001-0002-4000-8000-00805f9b34fb";
export const BASIC_PAIR_ACK_UUID = "ba51c001-0003-4000-8000-00805f9b34fb";

/** @deprecated Kept for reference; manufacturer-data transport removed in α37. */
export const BASIC_PAIR_COMPANY_ID = 0x0ba5;

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

/** GATT chunk header: seq u16 BE + total u16 BE. Payload fits under typical MTU−3. */
export const GATT_CHUNK_HEADER_LEN = 4;
/** Default payload per GATT write before MTU negotiation (safe for 23-byte ATT MTU). */
export const GATT_CHUNK_PAYLOAD_DEFAULT = 18;
/** Prefer larger writes after MTU exchange (MTU 512 → ~505 usable). */
export const GATT_CHUNK_PAYLOAD_LARGE = 500;

export function chunkBytes(data: Uint8Array, chunkSize: number): Uint8Array[] {
  if (data.length === 0) return [new Uint8Array(0)];
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    out.push(data.slice(i, i + chunkSize));
  }
  return out;
}

export function encodeGattChunk(seq: number, total: number, payload: Uint8Array): Uint8Array {
  if (seq < 0 || total < 1 || seq >= total) throw new Error("Invalid GATT chunk index");
  const out = new Uint8Array(GATT_CHUNK_HEADER_LEN + payload.length);
  out[0] = (seq >> 8) & 0xff;
  out[1] = seq & 0xff;
  out[2] = (total >> 8) & 0xff;
  out[3] = total & 0xff;
  out.set(payload, GATT_CHUNK_HEADER_LEN);
  return out;
}

export function decodeGattChunk(
  bytes: Uint8Array,
): { seq: number; total: number; payload: Uint8Array } | null {
  if (bytes.length < GATT_CHUNK_HEADER_LEN) return null;
  const seq = (bytes[0]! << 8) | bytes[1]!;
  const total = (bytes[2]! << 8) | bytes[3]!;
  if (total < 1 || seq >= total) return null;
  return { seq, total, payload: bytes.slice(GATT_CHUNK_HEADER_LEN) };
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

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeAckPayload(ok: boolean, message = ""): Uint8Array {
  const msg = utf8ToBytes(message);
  const out = new Uint8Array(1 + msg.length);
  out[0] = ok ? 0x01 : 0x02;
  out.set(msg, 1);
  return out;
}

export function decodeAckPayload(bytes: Uint8Array): { ok: boolean; message: string } {
  if (bytes.length < 1) return { ok: false, message: "Empty ACK" };
  const ok = bytes[0] === 0x01;
  const message = bytes.length > 1 ? new TextDecoder().decode(bytes.slice(1)) : "";
  return { ok, message };
}
