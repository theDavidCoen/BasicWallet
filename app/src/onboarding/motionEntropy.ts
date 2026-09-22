/**
 * Motion entropy for extra wallets without passkey (Penpot 14b).
 * Motion digests are mixed with CSPRNG — they never replace device randomness.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { randomEntropy32 } from "./mnemonicFromEntropy";

/** Path length (px) + accel samples needed for a full meter. */
const TOUCH_PATH_TARGET = 2400;
const ACCEL_SAMPLE_TARGET = 80;

export type MotionEntropyCollector = {
  addTouchSample: (x: number, y: number, tMs: number) => void;
  addAccelSample: (x: number, y: number, z: number, tMs: number) => void;
  /** 0…1 estimated collection progress. */
  progress: () => number;
  /** True when progress >= 1. */
  isComplete: () => boolean;
  /** SHA-256 digest of collected samples (32 bytes). */
  digest: () => Uint8Array;
  reset: () => void;
};

/**
 * Build a collector that hashes touch path + accelerometer deltas.
 * Weak/short motion still yields a digest; UI should require isComplete().
 */
export function createMotionEntropyCollector(): MotionEntropyCollector {
  const chunks: number[] = [];
  let lastTouch: { x: number; y: number; t: number } | null = null;
  let lastAccel: { x: number; y: number; z: number; t: number } | null = null;
  let touchPath = 0;
  let accelCount = 0;

  function push(...nums: number[]) {
    for (const n of nums) {
      // Quantize floats into reproducible u16-ish ints for hashing.
      const q = Math.round(n * 1000) | 0;
      chunks.push(q & 0xff, (q >> 8) & 0xff, (q >> 16) & 0xff, (q >> 24) & 0xff);
    }
  }

  return {
    addTouchSample(x, y, tMs) {
      if (lastTouch) {
        const dx = x - lastTouch.x;
        const dy = y - lastTouch.y;
        const dt = Math.max(1, tMs - lastTouch.t);
        touchPath += Math.hypot(dx, dy);
        push(x, y, tMs, dx, dy, dt);
      } else {
        push(x, y, tMs);
      }
      lastTouch = { x, y, t: tMs };
    },

    addAccelSample(x, y, z, tMs) {
      if (lastAccel) {
        const dx = x - lastAccel.x;
        const dy = y - lastAccel.y;
        const dz = z - lastAccel.z;
        const mag = Math.hypot(dx, dy, dz);
        if (mag < 0.02) return; // ignore noise
        accelCount += 1;
        push(x, y, z, tMs, dx, dy, dz);
      } else {
        push(x, y, z, tMs);
        accelCount += 1;
      }
      lastAccel = { x, y, z, t: tMs };
    },

    progress() {
      const touchP = Math.min(1, touchPath / TOUCH_PATH_TARGET);
      const accelP = Math.min(1, accelCount / ACCEL_SAMPLE_TARGET);
      // Either modality can fill the meter; both help.
      return Math.min(1, Math.max(touchP, accelP * 0.85 + touchP * 0.15));
    },

    isComplete() {
      return this.progress() >= 1;
    },

    digest() {
      if (chunks.length === 0) {
        // Should not create from empty motion — caller must check isComplete.
        return sha256(new Uint8Array([0]));
      }
      const bytes = new Uint8Array(chunks.length);
      for (let i = 0; i < chunks.length; i++) bytes[i] = chunks[i]! & 0xff;
      return sha256(bytes);
    },

    reset() {
      chunks.length = 0;
      lastTouch = null;
      lastAccel = null;
      touchPath = 0;
      accelCount = 0;
    },
  };
}

/**
 * Final 32-byte seed entropy: SHA-256(CSPRNG ‖ motionDigest).
 * Motion strengthens CSPRNG; it does not replace it.
 */
export async function combineCsprngWithMotion(motionDigest32: Uint8Array): Promise<Uint8Array> {
  if (motionDigest32.length !== 32) {
    throw new Error("Motion digest must be 32 bytes");
  }
  const csprng = await randomEntropy32();
  const mixed = new Uint8Array(64);
  mixed.set(csprng, 0);
  mixed.set(motionDigest32, 32);
  return sha256(mixed);
}

/** Meter string like `▓▓▓▓▓▓░░░░  62%`. */
export function formatEntropyMeter(progress01: number): string {
  const p = Math.max(0, Math.min(1, progress01));
  const filled = Math.round(p * 10);
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  return `entropy  ${bar}  ${Math.round(p * 100)}%`;
}
