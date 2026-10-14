/**
 * Defer Nostr gift-wrap / bot watchers until Home is idle or Chat/Contacts
 * focus. Closed-app FCM by-event-id catch-up stays independent.
 */

import { InteractionManager } from "react-native";

let scheduled = false;
/** True only after a successful boot attempt that invoked queue*Boot. */
let booted = false;
let bootInFlight: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const IDLE_DELAY_MS = 1_500;

async function bootWatchers(): Promise<void> {
  if (booted) return;
  if (bootInFlight) return bootInFlight;
  bootInFlight = (async () => {
    let contactOk = false;
    let botOk = false;
    try {
      const { queueContactShareWatchBoot } = await import(
        "../contacts/contactShareWatch"
      );
      queueContactShareWatchBoot();
      contactOk = true;
    } catch (e) {
      console.warn("[deferredWatchers] contact share boot failed", e);
    }
    try {
      const { queueBotWatchBoot } = await import("../agent/botWatch");
      queueBotWatchBoot();
      botOk = true;
    } catch (e) {
      console.warn("[deferredWatchers] bot boot failed", e);
    }
    // Latch only if at least one boot entrypoint ran — Chat can retry via ensure*.
    if (contactOk || botOk) {
      booted = true;
      console.log("[deferredWatchers] watchers started", { contactOk, botOk });
    } else {
      console.warn("[deferredWatchers] boot failed; will retry on ensure*");
    }
  })().finally(() => {
    bootInFlight = null;
  });
  return bootInFlight;
}

/**
 * Call after unlock / Home ready. Coalesces; runs after interactions + idle delay.
 */
export function scheduleDeferredWatchers(): void {
  if (booted || scheduled) return;
  scheduled = true;
  InteractionManager.runAfterInteractions(() => {
    if (idleTimer != null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void bootWatchers();
    }, IDLE_DELAY_MS);
  });
}

/** Chat stack focus — start immediately; retries if prior boot failed. */
export function ensureChatWatchers(): void {
  if (idleTimer != null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (booted) {
    // Already latched — resume live sub after stop / background.
    void (async () => {
      try {
        const { resumeContactShareWatch } = await import(
          "../contacts/contactShareWatch"
        );
        resumeContactShareWatch();
      } catch {
        /* ignore */
      }
      try {
        const { syncBotWatchWithEnabledState } = await import("../agent/botWatch");
        await syncBotWatchWithEnabledState();
      } catch {
        /* ignore */
      }
    })();
    return;
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
  booted = false;
  bootInFlight = null;
  if (idleTimer != null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}
