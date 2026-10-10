import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
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
  isPresencePromptActive,
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
/** Let Unlock paint + Activity resume before auto sheet (OEM cold start). */
const AUTO_BIO_DEFER_MS = 80;

/**
 * Penpot 01e / 01f — gate when 05c Biometrics lock is ON.
 *
 * Important (Samsung / Knox): never enable LocalAuthentication device-credential
 * fallback — that surfaces OS "Use PIN" even when no Basic app PIN exists.
 * App PIN is only our in-app pad, shown when Privacy → App PIN is set.
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
  const unlockingRef = useRef(false);
  const autoPromptedRef = useRef(false);
  /** Sync unlock for AppState — setState alone races with presence end → second bio. */
  const unlockedRef = useRef(false);
  /** AppLockGate mounts only after wallet bootstrap — track mid-session provision. */
  const prevHasWalletRef = useRef(hasWallet);
  const bioWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoBioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoBioInteractionRef = useRef<{ cancel: () => void } | null>(null);
  /** Ignore stale authenticateAsync results after cancelAuthenticate + retry. */
  const bioAttemptRef = useRef(0);

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
    autoPromptedRef.current = false;
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

  const clearAutoBioSchedule = useCallback(() => {
    autoBioInteractionRef.current?.cancel();
    autoBioInteractionRef.current = null;
    if (autoBioTimerRef.current) {
      clearTimeout(autoBioTimerRef.current);
      autoBioTimerRef.current = null;
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

  const tryBiometrics = useCallback(
    async (source: "auto" | "user" = "user") => {
      if (unlockingRef.current) {
        // User tap while auto/OEM auth is stuck or sheetless — cancel and retry.
        if (source !== "user") return;
        try {
          await LocalAuthentication.cancelAuthenticate();
        } catch {
          /* optional */
        }
        releaseBioLatch();
      }
      if (unlockingRef.current) return;

      clearAutoBioSchedule();
      const attempt = ++bioAttemptRef.current;
      unlockingRef.current = true;
      // Visual only — never Pressable.disabled; cold-start OEM delay must not eat taps.
      setBusy(true);
      setError(null);
      beginPresencePrompt();
      // Warm PIN availability in parallel — never block the system bio sheet.
      const pinPromise = refreshPinAvailable();

      clearBioWatchdog();
      bioWatchdogRef.current = setTimeout(() => {
        if (!unlockingRef.current || bioAttemptRef.current !== attempt) return;
        console.warn("[basic] bio auth watchdog — releasing latch");
        releaseBioLatch();
      }, BIO_AUTH_WATCHDOG_MS);

      try {
        // Fire OS prompt immediately. Do not await hasHardware/isEnrolled first
        // (those round-trips often delay the modal by seconds on cold tap).
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: t("privacy.unlockPrompt"),
          cancelLabel: t("common.cancel"),
          // Always disable OS/Knox device-PIN fallback. App PIN is in-app only.
          disableDeviceFallback: true,
        });

        // Superseded by a newer user tap / cancelAuthenticate retry.
        if (bioAttemptRef.current !== attempt) return;

        if (result.success) {
          // Mark unlocked before clearing presence — ending presence can let an
          // AppState "active" event re-enter enterLocked (second bio prompt).
          unlockedRef.current = true;
          setUnlocked(true);
          setError(null);
          setMode("bio");
          // Grace 0 + latch clear before backup/passphrase (FundsReceived notices).
          releaseBioLatch(0);
          await afterUnlock();
          return;
        }

        // Fail / cancel: clear latch before pin/status awaits (Xiaomi retap).
        releaseBioLatch();

        const err = result.error ?? "";
        const userDismissed =
          err === "user_cancel" ||
          err === "system_cancel" ||
          err === "app_cancel";

        const pinSet = await pinPromise;
        if (bioAttemptRef.current !== attempt) return;

        if (userDismissed) {
          // Stay on bio circle so dismiss → retap works; PIN stays via link.
          setError(null);
          return;
        }

        // Non-cancel failure: check whether biometrics are actually unavailable.
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
        // Safety if authenticateAsync threw before releaseBioLatch ran.
        if (bioAttemptRef.current === attempt && unlockingRef.current) {
          releaseBioLatch();
        }
      }
    },
    [
      afterUnlock,
      clearAutoBioSchedule,
      clearBioWatchdog,
      refreshPinAvailable,
      releaseBioLatch,
      t,
    ],
  );

  const enterLocked = useCallback(() => {
    if (unlockedRef.current) return;
    setUnlocked(false);
    setMode("bio");
    setError(null);
    // Do not await pin refresh before the bio sheet — warm in background.
    void refreshPinAvailable();
    if (autoPromptedRef.current) return;
    autoPromptedRef.current = true;
    clearAutoBioSchedule();
    // Paint Unlock + let Activity resume before auto sheet (Xiaomi cold start).
    autoBioInteractionRef.current = InteractionManager.runAfterInteractions(() => {
      autoBioTimerRef.current = setTimeout(() => {
        autoBioTimerRef.current = null;
        if (unlockedRef.current || unlockingRef.current) return;
        void tryBiometrics("auto");
      }, AUTO_BIO_DEFER_MS);
    });
  }, [clearAutoBioSchedule, refreshPinAvailable, tryBiometrics]);

  // Cold start only (this gate mounts after wallet bootstrap). Mid-session
  // provision must not re-enter lock — see hasWallet effect below.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await readPrivacySettings();
      if (cancelled) return;
      setLockEnabled(p.biometricsLock);
      // Never block the Unlock circle / auto bio on PIN warm or FLAG_SECURE.
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
      clearAutoBioSchedule();
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
      // Biometric system UI often backgrounds the app; ignore while our prompt is open.
      if (isPresencePromptActive()) return;

      if (next === "background") {
        // Drop RAM passphrase whenever we leave the foreground (SecureStore keeps it).
        lockBackupPassphraseSession();
        if (lockEnabled && hasWallet) {
          autoPromptedRef.current = false;
          unlockedRef.current = false;
          setUnlocked(false);
          setMode("bio");
        }
        return;
      }
      if (next === "active") {
        if (isPresencePromptActive()) return;
        if (lockEnabled && hasWallet && !unlockedRef.current) {
          void enterLocked();
          return;
        }
        // Biometrics lock OFF: background cleared the session but never reloads it
        // (unlike afterUnlock). Without this, dirty home/Nostr uploads stay stuck
        // forever after the first background — Settings still shows backup ON.
        if (hasWallet && !lockEnabled) {
          void flushEncryptedBackupAfterUnlock("resume-no-lock");
        }
      }
    };
    const sub = AppState.addEventListener("change", onState);
    return () => sub.remove();
  }, [hasWallet, lockEnabled, enterLocked]);

  if (!ready) return <>{children}</>;

  const showLock = hasWallet && lockEnabled && !unlocked;

  return (
    <View style={styles.fill}>
      {children}
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
              <BasicLogo scale={1.2} />
              <ScreenTitle style={styles.title}>
                {t("privacy.unlockTitle")}
              </ScreenTitle>
              <Caption style={styles.sub}>{t("privacy.unlockSub")}</Caption>

              <Pressable
                style={[styles.bioHit, busy && { opacity: 0.6 }]}
                // Always hit-testable: disabled={busy} ate cold-start taps while
                // Xiaomi delayed the system sheet. onPressIn fires before lift.
                onPressIn={() => void tryBiometrics("user")}
              >
                {busy ? (
                  <ActivityIndicator color={colors.fg} />
                ) : (
                  <Text style={styles.bioLabel}>
                    {t("privacy.touchFaceId")}
                  </Text>
                )}
              </Pressable>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              {pinAvailable ? (
                <Pressable
                  style={styles.pinLink}
                  onPress={() => {
                    setError(null);
                    setMode("pin");
                  }}
                >
                  <Text style={styles.pinLinkText}>
                    {t("privacy.usePinInstead")}
                  </Text>
                </Pressable>
              ) : (
                <Hint style={styles.hint}>{t("privacy.optionalPinHint")}</Hint>
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
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
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
  hint: {
    marginTop: "auto",
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    paddingBottom: 8,
  },
});
