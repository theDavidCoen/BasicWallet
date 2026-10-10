import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
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

  const tryBiometrics = useCallback(async () => {
    if (unlockingRef.current) return;
    unlockingRef.current = true;
    setBusy(true);
    setError(null);
    beginPresencePrompt();
    // Warm PIN availability in parallel — never block the system bio sheet.
    const pinPromise = refreshPinAvailable();
    try {
      // Fire OS prompt immediately. Do not await hasHardware/isEnrolled first
      // (those round-trips often delay the modal by seconds on cold tap).
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t("privacy.unlockPrompt"),
        cancelLabel: t("common.cancel"),
        // Always disable OS/Knox device-PIN fallback. App PIN is in-app only.
        disableDeviceFallback: true,
      });
      const pinSet = await pinPromise;
      if (!result.success) {
        // If biometrics are actually unavailable, prefer PIN / honest error.
        const bio = await getOsBiometricsStatus();
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
        // After cancel/fail, offer our PIN pad when configured.
        if (pinSet) setMode("pin");
        return;
      }
      // Mark unlocked before clearing the presence latch — ending presence can
      // let an AppState "active" event re-enter enterLocked (second bio prompt).
      unlockedRef.current = true;
      setUnlocked(true);
      setError(null);
      setMode("bio");
      // End presence *before* backup/passphrase work so FundsReceived notices work.
      endPresencePrompt(0);
      await afterUnlock();
    } finally {
      endPresencePrompt();
      setBusy(false);
      unlockingRef.current = false;
    }
  }, [afterUnlock, refreshPinAvailable, t]);

  const enterLocked = useCallback(async () => {
    if (unlockedRef.current) return;
    setUnlocked(false);
    setMode("bio");
    setError(null);
    // Do not await pin refresh before the bio sheet — warm in background.
    void refreshPinAvailable();
    if (!autoPromptedRef.current) {
      autoPromptedRef.current = true;
      await tryBiometrics();
    }
  }, [refreshPinAvailable, tryBiometrics]);

  // Cold start only (this gate mounts after wallet bootstrap). Mid-session
  // provision must not re-enter lock — see hasWallet effect below.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await readPrivacySettings();
      if (cancelled) return;
      setLockEnabled(p.biometricsLock);
      await refreshPinAvailable();
      await applyScreenCapture(p.blockScreenshots);

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

      await enterLocked();
    })();
    return () => {
      cancelled = true;
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
                disabled={busy}
                onPress={() => void tryBiometrics()}
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
