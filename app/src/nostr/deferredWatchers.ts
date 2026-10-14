/**
 * Defer Nostr gift-wrap / bot watchers until Home is idle or Chat/Contacts
 * focus. Closed-app FCM by-event-id catch-up stays independent.
 */

import { InteractionManager } from "react-native";

let scheduled = false;
let started = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const IDLE_DELAY_MS = 1_500;

async function bootWatchers(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const { queueContactShareWatchBoot } = await import(
      "../contacts/contactShareWatch"
    );
    queueContactShareWatchBoot();
  } catch (e) {
    console.warn("[deferredWatchers] contact share boot failed", e);
  }
  try {
    const { queueBotWatchBoot } = await import("../agent/botWatch");
    queueBotWatchBoot();
  } catch (e) {
    console.warn("[deferredWatchers] bot boot failed", e);
  }
  console.log("[deferredWatchers] watchers started");
}

/**
 * Call after unlock / Home ready. Coalesces; runs after interactions + idle delay.
 */
export function scheduleDeferredWatchers(): void {
  if (started || scheduled) return;
  scheduled = true;
  InteractionManager.runAfterInteractions(() => {
    if (idleTimer != null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void bootWatchers();
    }, IDLE_DELAY_MS);
  });
}

/** Chat stack focus — start immediately if not yet. */
export function ensureChatWatchers(): void {
  if (idleTimer != null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  void bootWatchers();
}

/** Contacts focus — same as chat for gift-wrap / directory. */
export function ensureContactsWatchers(): void {
  ensureChatWatchers();
}

/** Factory reset / logout — allow re-schedule on next session. */
export function resetDeferredWatchersLatch(): void {
  scheduled = false;
  started = false;
  if (idleTimer != null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}
