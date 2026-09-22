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
import { UnlockPinPad } from "../screens/SetAppPinScreen";
import { hasAppPin } from "./appPin";
import { getOsBiometricsStatus } from "./osBiometrics";
import { readPrivacySettings } from "./privacySettings";
import {
  beginPresencePrompt,
  endPresencePrompt,
  isPresencePromptActive,
  subscribeAppUnlockFromPresence,
} from "./presencePrompt";
import {
  isBackupPackageDirty,
  lockBackupPassphraseSession,
  scheduleEncryptedBackupSync,
  unlockBackupPassphraseSession,
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
  const { hasWallet, ready } = useWallet();
  const [lockEnabled, setLockEnabled] = useState(true);
  const [pinAvailable, setPinAvailable] = useState(false);
  const [mode, setMode] = useState<"bio" | "pin">("bio");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlockingRef = useRef(false);
  const autoPromptedRef = useRef(false);
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
    setUnlocked(true);
    setError(null);
    setMode("bio");
    autoPromptedRef.current = false;
    const loaded = await unlockBackupPassphraseSession();
    if (loaded && (await isBackupPackageDirty())) {
      // Far off the unlock paint path — PBKDF2 must not run during Home mount.
      scheduleEncryptedBackupSync("post-unlock-dirty", 8_000);
    }
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
    try {
      const pinSet = await refreshPinAvailable();
      const bio = await getOsBiometricsStatus();
      if (!bio.available) {
        if (pinSet) {
          setMode("pin");
          return;
        }
        setError(
          "OS biometrics are off and no App PIN is set. Enable Face ID / fingerprint in system settings, or set an App PIN in Privacy.",
        );
        return;
      }
      // Always disable OS/Knox device-PIN fallback. App PIN is in-app only.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Basic",
        cancelLabel: "Cancel",
        disableDeviceFallback: true,
      });
      if (!result.success) {
        setError("Authentication failed");
        // After cancel/fail, offer our PIN pad when configured.
        if (pinSet) setMode("pin");
        return;
      }
      // End presence *before* afterUnlock — passphrase/backup work must not
      // keep isPresencePromptActive true (that ate FundsReceived notices).
      endPresencePrompt(0);
      await afterUnlock();
    } finally {
      endPresencePrompt();
      setBusy(false);
      unlockingRef.current = false;
    }
  }, [afterUnlock, refreshPinAvailable]);

  const enterLocked = useCallback(async () => {
    setUnlocked(false);
    setMode("bio");
    setError(null);
    await refreshPinAvailable();
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
        setUnlocked(true);
        if (presentAtBoot) {
          const loaded = await unlockBackupPassphraseSession();
          if (loaded && (await isBackupPackageDirty())) {
            scheduleEncryptedBackupSync("no-lock-dirty", 8_000);
          }
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
        lockBackupPassphraseSession();
        if (lockEnabled && hasWallet) {
          autoPromptedRef.current = false;
          setUnlocked(false);
          setMode("bio");
        }
        return;
      }
      if (next === "active" && lockEnabled && hasWallet && !unlocked) {
        if (isPresencePromptActive()) return;
        void enterLocked();
      }
    };
    const sub = AppState.addEventListener("change", onState);
    return () => sub.remove();
  }, [hasWallet, lockEnabled, unlocked, enterLocked]);

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
              <Text style={styles.title}>UNLOCK</Text>
              <Text style={styles.sub}>
                Confirm it&apos;s you.{"\n"}Biometrics preferred.
              </Text>

              <Pressable
                style={[styles.bioHit, busy && { opacity: 0.6 }]}
                disabled={busy}
                onPress={() => void tryBiometrics()}
              >
                {busy ? (
                  <ActivityIndicator color={colors.fg} />
                ) : (
                  <Text style={styles.bioLabel}>Touch / Face ID</Text>
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
                  <Text style={styles.pinLinkText}>Use PIN instead</Text>
                </Pressable>
              ) : (
                <Text style={styles.hint}>
                  Optional app PIN: Settings → Privacy → App PIN
                </Text>
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
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    marginTop: 48,
    textAlign: "center",
  },
  sub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 12,
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
