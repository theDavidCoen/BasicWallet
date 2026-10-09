/**
 * Home onboarding tour (Spotlight D) — fresh-install gate.
 *
 * Show only when pending is armed (first wallet → Home) and not done.
 * Reset app marks done so the tour does not reappear after factory reset.
 * True uninstall clears AsyncStorage → tour can arm again on next first wallet.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

/** Survives factory reset (set during reset). Cleared only by uninstall. */
export const HOME_TOUR_DONE_KEY = "basic.wallet.homeTour.done.v1";

/** Armed on first-wallet Ready / backup-success / pair → Home when !done. */
export const HOME_TOUR_PENDING_KEY = "basic.wallet.homeTour.pending.v1";

export async function isHomeTourDone(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HOME_TOUR_DONE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function isHomeTourPending(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HOME_TOUR_PENDING_KEY)) === "1";
  } catch {
    return false;
  }
}

/** Call when first wallet lands on Home (Ready / backup success / pair). No-op if already done. */
export async function armHomeTourIfNeeded(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(HOME_TOUR_DONE_KEY)) === "1") return;
    await AsyncStorage.setItem(HOME_TOUR_PENDING_KEY, "1");
  } catch {
    /* optional */
  }
}

/** Persist dismiss (Skip / Done / tap outside). */
export async function markHomeTourDone(): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [HOME_TOUR_DONE_KEY, "1"],
      [HOME_TOUR_PENDING_KEY, "0"],
    ]);
    await AsyncStorage.removeItem(HOME_TOUR_PENDING_KEY);
  } catch {
    /* optional */
  }
}

/**
 * Factory reset: never re-show tour after Reset app.
 * Caller should run after AsyncStorage wipe (key is not in PRESERVE list;
 * we re-write done so post-reset onboarding skips the tour).
 */
export async function markHomeTourDoneForFactoryReset(): Promise<void> {
  try {
    await AsyncStorage.setItem(HOME_TOUR_DONE_KEY, "1");
    await AsyncStorage.removeItem(HOME_TOUR_PENDING_KEY);
  } catch {
    /* optional */
  }
}

/** QA: clear done + pending so the next arm (or force) can show the tour again. */
export async function clearHomeTourFlagsForQa(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([HOME_TOUR_DONE_KEY, HOME_TOUR_PENDING_KEY]);
  } catch {
    /* optional */
  }
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
