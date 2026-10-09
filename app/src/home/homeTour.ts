/**
 * Home onboarding tour (Spotlight D) — fresh-install gate.
 *
 * Show only when pending is armed (first wallet → Home) and not done.
 * Reset app marks done so the tour does not reappear after factory reset.
 * True uninstall clears AsyncStorage → tour can arm again on next first wallet.
 *
 * Sync latches: Home must open the Modal on first paint (no AsyncStorage race
 * that leaves POS/QR swipeable before the overlay appears).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

/** Survives factory reset (set during reset). Cleared only by uninstall. */
export const HOME_TOUR_DONE_KEY = "basic.wallet.homeTour.done.v1";

/** Armed on first-wallet Ready / backup-success / pair → Home when !done. */
export const HOME_TOUR_PENDING_KEY = "basic.wallet.homeTour.pending.v1";

/** In-memory: set true in armHomeTourIfNeeded before any await. */
let pendingLatch = false;
/** In-memory: true once done is known; null = unread. */
let doneLatch: boolean | null = null;
/** True while the tour Modal is visible — banners/toasts must stay hidden. */
let tourUiOpen = false;
const tourUiListeners = new Set<() => void>();

export function isHomeTourPendingSync(): boolean {
  return pendingLatch;
}

export function isHomeTourDoneSync(): boolean {
  return doneLatch === true;
}

/** Home chat/backup banners check this (and subscribe) to stay off during the tour. */
export function isHomeTourUiOpen(): boolean {
  return tourUiOpen;
}

export function setHomeTourUiOpen(open: boolean): void {
  if (tourUiOpen === open) return;
  tourUiOpen = open;
  for (const fn of tourUiListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeHomeTourUi(listener: () => void): () => void {
  tourUiListeners.add(listener);
  return () => {
    tourUiListeners.delete(listener);
  };
}

export async function isHomeTourDone(): Promise<boolean> {
  try {
    if (doneLatch === true) return true;
    const done = (await AsyncStorage.getItem(HOME_TOUR_DONE_KEY)) === "1";
    doneLatch = done;
    if (done) pendingLatch = false;
    return done;
  } catch {
    return false;
  }
}

export async function isHomeTourPending(): Promise<boolean> {
  try {
    if (doneLatch === true || (await isHomeTourDone())) return false;
    if (pendingLatch) return true;
    const pending = (await AsyncStorage.getItem(HOME_TOUR_PENDING_KEY)) === "1";
    if (pending) pendingLatch = true;
    return pending;
  } catch {
    return pendingLatch;
  }
}

/**
 * Call when first wallet is about to land on Home (Ready / backup success / pair).
 * Sets the sync latch immediately so Home can show the Modal on first paint.
 * No-op if already done.
 */
export async function armHomeTourIfNeeded(): Promise<void> {
  if (doneLatch === true) return;
  // Optimistic latch immediately so any concurrent Home mount sees pending.
  pendingLatch = true;
  // Hide Home banners before Home/Modal paint (chat toast was racing the tour).
  setHomeTourUiOpen(true);
  try {
    if ((await AsyncStorage.getItem(HOME_TOUR_DONE_KEY)) === "1") {
      doneLatch = true;
      pendingLatch = false;
      setHomeTourUiOpen(false);
      return;
    }
    doneLatch = false;
    await AsyncStorage.setItem(HOME_TOUR_PENDING_KEY, "1");
  } catch {
    pendingLatch = true;
  }
}

/** Persist dismiss (Skip / Done / tap outside). */
export async function markHomeTourDone(): Promise<void> {
  pendingLatch = false;
  doneLatch = true;
  setHomeTourUiOpen(false);
  try {
    await AsyncStorage.setItem(HOME_TOUR_DONE_KEY, "1");
    await AsyncStorage.removeItem(HOME_TOUR_PENDING_KEY);
  } catch {
    /* optional */
  }
}

/**
 * Factory reset: never re-show tour after Reset app.
 * Caller should run after AsyncStorage wipe.
 */
export async function markHomeTourDoneForFactoryReset(): Promise<void> {
  pendingLatch = false;
  doneLatch = true;
  try {
    await AsyncStorage.setItem(HOME_TOUR_DONE_KEY, "1");
    await AsyncStorage.removeItem(HOME_TOUR_PENDING_KEY);
  } catch {
    /* optional */
  }
}

/** QA: clear done + pending so the next arm (or force) can show the tour again. */
export async function clearHomeTourFlagsForQa(): Promise<void> {
  pendingLatch = false;
  doneLatch = null;
  try {
    await AsyncStorage.multiRemove([HOME_TOUR_DONE_KEY, HOME_TOUR_PENDING_KEY]);
  } catch {
    /* optional */
  }
}

/**
 * QA: force tour on next Home focus (About long-press Version).
 * Does not change product UX — measurement / re-test only.
 */
let forceTourRequest = false;

export async function requestForceHomeTourForQa(): Promise<void> {
  await clearHomeTourFlagsForQa();
  pendingLatch = true;
  doneLatch = false;
  forceTourRequest = true;
  setHomeTourUiOpen(true);
  try {
    await AsyncStorage.setItem(HOME_TOUR_PENDING_KEY, "1");
  } catch {
    /* latch is enough for sync open */
  }
}

/**
 * QA reopen only. Do **not** treat product `pendingLatch` as a force request —
 * that re-opened the tour on every Home focus while pending and raced Skip
 * (latches cleared in a microtask) back to `tourOpen=true` mid rate-fetch.
 */
export function consumeForceHomeTourForQa(): boolean {
  if (!forceTourRequest) return false;
  forceTourRequest = false;
  return true;
}

export type HomeTourStepId = "pos" | "qr" | "settings" | "add_wallet" | "fiat";

export type HomeTourStep = {
  id: HomeTourStepId;
  n: 1 | 2 | 3 | 4 | 5;
  /** Gesture hint rendered over Home chrome. */
  hint: "swipe_ltr" | "swipe_rtl" | "pulse_settings" | "pulse_avatar" | "pulse_fiat";
  titleKey: string;
  bodyKey: string;
};

export const HOME_TOUR_STEPS: readonly HomeTourStep[] = [
  {
    id: "pos",
    n: 1,
    hint: "swipe_ltr",
    titleKey: "home.tourPosTitle",
    bodyKey: "home.tourPosBody",
  },
  {
    id: "qr",
    n: 2,
    hint: "swipe_rtl",
    titleKey: "home.tourQrTitle",
    bodyKey: "home.tourQrBody",
  },
  {
    id: "settings",
    n: 3,
    hint: "pulse_settings",
    titleKey: "home.tourSettingsTitle",
    bodyKey: "home.tourSettingsBody",
  },
  {
    id: "add_wallet",
    n: 4,
    hint: "pulse_avatar",
    titleKey: "home.tourAddWalletTitle",
    bodyKey: "home.tourAddWalletBody",
  },
  {
    id: "fiat",
    n: 5,
    hint: "pulse_fiat",
    titleKey: "home.tourFiatTitle",
    bodyKey: "home.tourFiatBody",
  },
] as const;
