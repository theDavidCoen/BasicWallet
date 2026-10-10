import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import * as LocalAuthentication from "expo-local-authentication";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BasicLogo } from "../components/BasicLogo";
import { Caption, Hint, ScreenTitle } from "../components/ui";
import { useI18n } from "../i18n";
import { UnlockPinPad } from "../screens/SetAppPinScreen";
import { hasAppPin } from "./appPin";
import { getOsBiometricsStatus } from "./osBiometrics";
import { readPrivacySettings } from "./privacySettings";
import { notifyAppUnlocked } from "./appLockEvents";
import {
  beginPresencePrompt,
  endPresencePrompt,
  isPresencePromptInFlight,
  resetPresencePrompt,
  subscribeAppUnlockFromPresence,
} from "./presencePrompt";
import {
  flushEncryptedBackupAfterUnlock,
  lockBackupPassphraseSession,
} from "../nostr/backupSync";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";

/** Xiaomi can leave authenticateAsync pending without a visible sheet. */
const BIO_AUTH_WATCHDOG_MS = 12_000;

/**
 * Penpot 01e / 01f — gate when 05c Biometrics lock is ON.
 *
 * Important (Samsung / Knox): never enable LocalAuthentication device-credential
 * fallback — that surfaces OS "Use PIN" even when no Basic app PIN exists.
 * App PIN is only our in-app pad, shown when Privacy → App PIN is set.
 *
 * Unlock reliability (Xiaomi): no auto-prompt (user taps the circle). While an
 * OS auth is in flight, extra taps queue at most one retry after settle — never
 * cancelAuthenticate mid-flight (that made rapid taps cancel each other).
 * Warm resume: abort stale auth + clear latches on true background so the
 * circle is interactive immediately when the app returns.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { hasWallet, ready } = useWallet();
  const [lockEnabled, setLockEnabled] = useState(true);
  const [pinAvailable, setPinAvailable] = useState(false);
  const [mode, setMode] = useState<"bio" | "pin">("bio");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Remount bio touchable after resume — MIUI can leave a dead responder. */
  const [lockEpoch, setLockEpoch] = useState(0);
  const unlockingRef = useRef(false);
  /** Sync unlock for AppState — setState alone races with presence end → second bio. */
  const unlockedRef = useRef(false);
  /** AppLockGate mounts only after wallet bootstrap — track mid-session provision. */
  const prevHasWalletRef = useRef(hasWallet);
  const bioWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ignore stale authenticateAsync results after a newer attempt starts. */
  const bioAttemptRef = useRef(0);
  /** At most one user retry after the in-flight auth settles (no mid-flight cancel). */
  const pendingUserRetryRef = useRef(false);

  const applyScreenCapture = useCallback(async (block: boolean) => {
    try {
      if (block) await ScreenCapture.preventScreenCaptureAsync();
      else await ScreenCapture.allowScreenCaptureAsync();
    } catch {
      /* optional */
    }
  }, []);

  const refreshPinAvailable = useCallback(async () => {
    const pinSet = await hasAppPin();
    setPinAvailable(pinSet);
    return pinSet;
  }, []);

  const afterUnlock = useCallback(async () => {
    unlockedRef.current = true;
    setUnlocked(true);
    setError(null);
    setMode("bio");
    pendingUserRetryRef.current = false;
    // Push deep-link / other deferred UI — after lock overlay clears.
    notifyAppUnlocked();
    // Far off the unlock paint path — PBKDF2 must not run during Home mount.
    await flushEncryptedBackupAfterUnlock("post-unlock");
  }, []);

  // Successful requireUserPresence (backup enable, export, …) counts as unlock.
  useEffect(() => {
    return subscribeAppUnlockFromPresence(() => {
      void afterUnlock();
    });
  }, [afterUnlock]);

  const clearBioWatchdog = useCallback(() => {
    if (bioWatchdogRef.current) {
      clearTimeout(bioWatchdogRef.current);
      bioWatchdogRef.current = null;
    }
  }, []);

  const releaseBioLatch = useCallback(
    (presenceGraceMs?: number) => {
      clearBioWatchdog();
      if (presenceGraceMs !== undefined) endPresencePrompt(presenceGraceMs);
      else endPresencePrompt();
      setBusy(false);
      unlockingRef.current = false;
    },
    [clearBioWatchdog],
  );

  /** True Home / recents background: kill hung authenticateAsync + all latches. */
  const abortStaleBioAuth = useCallback(() => {
    bioAttemptRef.current += 1;
    pendingUserRetryRef.current = false;
    clearBioWatchdog();
    unlockingRef.current = false;
    setBusy(false);
    setError(null);
    resetPresencePrompt();
    void LocalAuthentication.cancelAuthenticate().catch(() => {
      /* optional */
    });
  }, [clearBioWatchdog]);

  const runBiometrics = useCallback(async () => {
    if (unlockingRef.current || unlockedRef.current) return;

    const attempt = ++bioAttemptRef.current;
    unlockingRef.current = true;
    setBusy(true);
    setError(null);
    beginPresencePrompt();
    // Warm PIN in parallel — never block the system bio sheet.
    const pinPromise = refreshPinAvailable();

    clearBioWatchdog();
    bioWatchdogRef.current = setTimeout(() => {
      if (!unlockingRef.current || bioAttemptRef.current !== attempt) return;
      console.warn("[basic] bio auth watchdog — releasing latch");
      releaseBioLatch();
    }, BIO_AUTH_WATCHDOG_MS);

    try {
      // Fire OS prompt immediately. No hasHardware/isEnrolled awaits first.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t("privacy.unlockPrompt"),
        cancelLabel: t("common.cancel"),
        disableDeviceFallback: true,
      });

      if (bioAttemptRef.current !== attempt) return;

      if (result.success) {
        pendingUserRetryRef.current = false;
        unlockedRef.current = true;
        setUnlocked(true);
        setError(null);
        setMode("bio");
        // Grace 0 before backup work so FundsReceived notices work.
        releaseBioLatch(0);
        await afterUnlock();
        return;
      }

      // Clear latch before pin/status awaits so the circle is live again.
      releaseBioLatch();

      const err = result.error ?? "";
      const userDismissed =
        err === "user_cancel" ||
        err === "system_cancel" ||
        err === "app_cancel";

      const pinSet = await pinPromise;
      if (bioAttemptRef.current !== attempt) return;

      if (userDismissed) {
        setError(null);
        return;
      }

      const bio = await getOsBiometricsStatus();
      if (bioAttemptRef.current !== attempt) return;
      if (!bio.available) {
        if (pinSet) {
          setMode("pin");
          setError(null);
          return;
        }
        setError(t("privacy.bioOffNoPin"));
        return;
      }
      setError(t("privacy.authFailed"));
      if (pinSet) setMode("pin");
    } catch {
      if (bioAttemptRef.current !== attempt) return;
      releaseBioLatch();
      setError(t("privacy.authFailed"));
    } finally {
      if (bioAttemptRef.current === attempt && unlockingRef.current) {
        releaseBioLatch();
      }
      // One queued tap after settle — never cancelAuthenticate mid-flight.
      if (
        !unlockedRef.current &&
        pendingUserRetryRef.current &&
        bioAttemptRef.current === attempt
      ) {
        pendingUserRetryRef.current = false;
        void runBiometrics();
      }
    }
  }, [afterUnlock, clearBioWatchdog, refreshPinAvailable, releaseBioLatch, t]);

  const onBioCirclePress = useCallback(() => {
    if (unlockedRef.current) return;
    if (unlockingRef.current) {
      // In flight: queue a single retry after settle (Xiaomi rapid taps).
      pendingUserRetryRef.current = true;
      return;
    }
    pendingUserRetryRef.current = false;
    void runBiometrics();
  }, [runBiometrics]);

  const enterLocked = useCallback(() => {
    // Always present a clean Unlock UI (warm resume may leave busy/latches).
    unlockedRef.current = false;
    pendingUserRetryRef.current = false;
    unlockingRef.current = false;
    setUnlocked(false);
    setBusy(false);
    setMode("bio");
    setError(null);
    void refreshPinAvailable();
    // No auto-prompt on cold start or resume — user taps the circle.
  }, [refreshPinAvailable]);

  // Cold start only (this gate mounts after wallet bootstrap). Mid-session
  // provision must not re-enter lock — see hasWallet effect below.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await readPrivacySettings();
      if (cancelled) return;
      setLockEnabled(p.biometricsLock);
      void refreshPinAvailable();
      void applyScreenCapture(p.blockScreenshots);

      const presentAtBoot = prevHasWalletRef.current;
      if (!presentAtBoot || !p.biometricsLock) {
        unlockedRef.current = true;
        setUnlocked(true);
        notifyAppUnlocked();
        if (presentAtBoot) {
          await flushEncryptedBackupAfterUnlock("no-lock");
        }
        return;
      }

      enterLocked();
    })();
    return () => {
      cancelled = true;
      clearBioWatchdog();
    };
    // Mount-once cold start. enterLocked/hasWallet changes must not re-lock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Path C / create: wallet appears after UV already succeeded — do not show UNLOCK again.
  useEffect(() => {
    const was = prevHasWalletRef.current;
    prevHasWalletRef.current = hasWallet;
    if (was || !hasWallet) return;
    void afterUnlock();
  }, [hasWallet, afterUnlock]);

  useEffect(() => {
    const onState = (next: AppStateStatus) => {
      // OS biometric chrome often goes active→inactive only. Do not cancel auth
      // there (would dismiss the sheet). True Home/recents uses "background".
      if (next === "inactive") {
        return;
      }

      if (next === "background") {
        // Always abort — hung authenticateAsync + presence grace were leaving
        // Unlock with unlockingRef/busy stuck after warm resume (Xiaomi).
        abortStaleBioAuth();
        lockBackupPassphraseSession();
        if (lockEnabled && hasWallet) {
          unlockedRef.current = false;
          setUnlocked(false);
          setMode("bio");
          setLockEpoch((n) => n + 1);
        }
        return;
      }

      if (next === "active") {
        // Sheet still up: leave the in-flight auth alone.
        if (isPresencePromptInFlight()) return;

        // Fresh interactive Unlock after Home/recents (clear grace + latches).
        abortStaleBioAuth();
        if (lockEnabled && hasWallet && !unlockedRef.current) {
          enterLocked();
          setLockEpoch((n) => n + 1);
          return;
        }
        if (hasWallet && !lockEnabled) {
          void flushEncryptedBackupAfterUnlock("resume-no-lock");
        }
      }
    };
    const sub = AppState.addEventListener("change", onState);
    return () => sub.remove();
  }, [hasWallet, lockEnabled, enterLocked, abortStaleBioAuth]);

  if (!ready) return <>{children}</>;

  const showLock = hasWallet && lockEnabled && !unlocked;

  return (
    <View style={styles.fill}>
      {/* Underlay must not steal touches while Unlock is up (warmup / Home). */}
      <View
        style={styles.fill}
        pointerEvents={showLock ? "none" : "auto"}
        collapsable={false}
      >
        {children}
      </View>
      {showLock ? (
        <View
          style={[
            styles.root,
            {
              paddingTop: insets.top + 24,
              paddingBottom: insets.bottom + 24,
              alignItems: mode === "pin" ? "stretch" : "center",
            },
          ]}
          pointerEvents="auto"
          collapsable={false}
        >
          {mode === "pin" && pinAvailable ? (
            <UnlockPinPad
              onSuccess={() => void afterUnlock()}
              onCancel={() => {
                setMode("bio");
                setError(null);
              }}
            />
          ) : (
            <>
              <View pointerEvents="none">
                <BasicLogo scale={1.2} />
                <ScreenTitle style={styles.title}>
                  {t("privacy.unlockTitle")}
                </ScreenTitle>
                <Caption style={styles.sub}>{t("privacy.unlockSub")}</Caption>
              </View>

              {/*
                TouchableOpacity + large hitSlop: more reliable than Pressable
                onPressIn on MIUI. Spinner is a non-interactive overlay so child
                swaps do not abort the responder. No disabled / opacity on the
                touch target during auth.
              */}
              <TouchableOpacity
                key={`bio-hit-${lockEpoch}`}
                style={styles.bioHit}
                activeOpacity={1}
                delayPressIn={0}
                hitSlop={{ top: 28, bottom: 28, left: 28, right: 28 }}
                pressRetentionOffset={{
                  top: 40,
                  bottom: 40,
                  left: 40,
                  right: 40,
                }}
                accessibilityRole="button"
                accessibilityLabel={t("privacy.touchFaceId")}
                onPress={onBioCirclePress}
                {...(Platform.OS === "android"
                  ? { touchSoundDisabled: true }
                  : null)}
              >
                <Text style={styles.bioLabel} pointerEvents="none">
                  {t("privacy.touchFaceId")}
                </Text>
                {busy ? (
                  <View style={styles.bioBusyOverlay} pointerEvents="none">
                    <ActivityIndicator color={colors.fg} />
                  </View>
                ) : null}
              </TouchableOpacity>

              {error ? (
                <Text style={styles.error} pointerEvents="none">
                  {error}
                </Text>
              ) : null}

              {pinAvailable ? (
                <TouchableOpacity
                  style={styles.pinLink}
                  activeOpacity={0.7}
                  hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
                  onPress={() => {
                    setError(null);
                    setMode("pin");
                  }}
                >
                  <Text style={styles.pinLinkText}>
                    {t("privacy.usePinInstead")}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View pointerEvents="none" style={styles.hintWrap}>
                  <Hint style={styles.hint}>{t("privacy.optionalPinHint")}</Hint>
                </View>
              )}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    alignItems: "center",
    paddingHorizontal: 28,
    zIndex: 100,
    elevation: 100,
  },
  title: {
    marginTop: 48,
    marginBottom: 0,
  },
  sub: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
    marginBottom: 0,
  },
  bioHit: {
    marginTop: 48,
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 2,
    borderColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bioBusyOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  bioLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  error: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: "#FF6B6B",
    marginTop: 20,
    textAlign: "center",
  },
  pinLink: {
    marginTop: "auto",
    paddingVertical: 16,
  },
  pinLinkText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
    textAlign: "center",
  },
  hintWrap: {
    marginTop: "auto",
    alignSelf: "stretch",
  },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    paddingBottom: 8,
  },
});
