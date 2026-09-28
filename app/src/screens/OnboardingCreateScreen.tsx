import { useNavigation } from "@react-navigation/native";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import * as Passkeys from "react-native-passkeys";
import type { RootNav } from "../navigation/types";
import { BasicLogo } from "../components/BasicLogo";
import { InteractiveBottomSheet } from "../components/sheet/InteractiveBottomSheet";
import { colors } from "../theme/colors";
import { PasskeyPrfUnavailableError } from "../onboarding/passkeyPrf";
import { needsOnboardingSecurityGate } from "../security/onboardingSecurityGate";
import type { OnboardingContinueTo } from "../security/onboardingSecurityGate";
import {
  cancelPairBle,
  ensureBlePermissions,
  runRequesterBleSession,
} from "../pair/pairBleTransport";
import {
  applyPairLoginPackage,
  decodePairLoginPackage,
} from "../pair/pairLoginPackage";
import {
  decodeWireEnvelope,
  decryptPairPayload,
  generatePairEphemeralKeypair,
} from "../pair/pairProtocol";
import { useWallet } from "../wallet/WalletProvider";

/**
 * Penpot `11 Onboarding Create` (390×844):
 * logo y≈180 scale 1.1 · taglines y≈300 · CTAs y≈400/468 · restore y≈780.
 * Logo is centered (Penpot places it slightly left; we center on purpose).
 */
const PENPOT = {
  frameH: 844,
  logoY: 180,
  tagY: 300,
  btn1Y: 400,
  btn2Y: 468,
  footerY: 780,
  btnH: 52,
  logoScale: 1.7,
} as const;

/** Matches BasicLogo height math (VIEW_H * 0.55 * scale). */
const LOGO_H = Math.round(62 * 0.55 * PENPOT.logoScale);

function BluetoothIcon({ size = 18, color = colors.fg }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z"
        fill={color}
      />
    </Svg>
  );
}

export function OnboardingCreateScreen() {
  const navigation = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const { beginQuietImportSync, selectWallet } = useWallet();
  const [busy, setBusy] = useState(false);
  const [pairInfoOpen, setPairInfoOpen] = useState(false);
  const [pairStatus, setPairStatus] = useState("Waiting for nearby device…");
  const [pairBusy, setPairBusy] = useState(false);
  const [pairArmed, setPairArmed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!pairArmed) return;

    let cancelled = false;
    const ac = new AbortController();
    abortRef.current = ac;

    void (async () => {
      setPairBusy(true);
      try {
        const eph = await generatePairEphemeralKeypair();
        if (cancelled) return;
        setPairStatus("Waiting for nearby device…");
        const wire = await runRequesterBleSession({
          lobbyHash8: eph.lobbyHash8,
          pubCompressed: eph.pubCompressed,
          onStatus: (msg) => {
            if (!cancelled) setPairStatus(msg);
          },
          signal: ac.signal,
        });
        if (cancelled || ac.signal.aborted) return;
        setPairStatus("Decrypting…");
        const envelope = decodeWireEnvelope(wire);
        const plain = decryptPairPayload(envelope, eph.sk);
        const pkg = decodePairLoginPackage(plain);
        const applied = await applyPairLoginPackage(pkg);
        beginQuietImportSync();
        await selectWallet(applied.preferredWalletId);
        if (applied.backupReArmed) {
          Alert.alert(
            "Paired",
            applied.channel === "home"
              ? "Home server backup is on."
              : "Nostr backup is on.",
          );
        }
        navigation.reset({ index: 0, routes: [{ name: "Home" }] });
      } catch (e) {
        if (cancelled || ac.signal.aborted) return;
        // Stay on onboarding — user can still Continue / Restore. Soft status only.
        setPairStatus(
          e instanceof Error && /permission/i.test(e.message)
            ? "Bluetooth permission needed to pair nearby"
            : "Waiting for nearby device…",
        );
      } finally {
        if (!cancelled) setPairBusy(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      void cancelPairBle();
    };
  }, [pairArmed, beginQuietImportSync, navigation, selectWallet]);

  async function openPairInfo() {
    setPairInfoOpen(true);
    const ok = await ensureBlePermissions();
    if (!ok) {
      setPairStatus("Bluetooth permission needed to pair nearby");
      return;
    }
    setPairArmed(true);
  }

  async function goCreate(continueTo: OnboardingContinueTo) {
    abortRef.current?.abort();
    void cancelPairBle();
    if (await needsOnboardingSecurityGate()) {
      navigation.navigate("OnboardingSecurity", { continueTo });
      return;
    }
    if (continueTo === "restore") {
      navigation.navigate("RestoreWallet", { mode: "full" });
      return;
    }
    navigation.navigate("TermsOfUse", {
      mode: continueTo === "passkey" ? "passkey" : "device-only",
    });
  }

  async function onContinuePasskey() {
    setBusy(true);
    try {
      if (!Passkeys.isSupported()) {
        throw new PasskeyPrfUnavailableError(
          "Passkeys are not supported on this device. Need platform Credential Manager / iCloud Keychain.",
        );
      }
      await goCreate("passkey");
    } catch (e) {
      if (e instanceof PasskeyPrfUnavailableError) {
        Alert.alert(
          "Passkey PRF",
          e.message + "\n\nUse Continue without passkey for Advanced Backup, or Restore.",
        );
      } else {
        Alert.alert("Error", e instanceof Error ? e.message : "Passkey failed");
      }
    } finally {
      setBusy(false);
    }
  }

  const logoMarginTop = Math.max(24, PENPOT.logoY - insets.top);
  const tagMarginTop = PENPOT.tagY - PENPOT.logoY - LOGO_H;
  const btnMarginTop = PENPOT.btn1Y - PENPOT.tagY - 48;
  const btnGap = PENPOT.btn2Y - PENPOT.btn1Y - PENPOT.btnH;
  const sheetBottomPad = Math.max(insets.bottom, 48) + 20;

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 12) + 8,
        },
      ]}
    >
      <View style={[styles.logoWrap, { marginTop: logoMarginTop }]}>
        <BasicLogo scale={PENPOT.logoScale} />
      </View>

      <Text style={[styles.tagline, { marginTop: Math.max(16, tagMarginTop) }]}>
        Your payments app.{"\n"}
        No seed phrase in setup.{"\n"}
        OS passkey + multi-cloud backups.
      </Text>

      <View style={{ marginTop: Math.max(24, btnMarginTop) }}>
        <Pressable
          style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void onContinuePasskey()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryBtnText}>Continue</Text>
          )}
        </Pressable>

        <Text
          style={[styles.textLink, { marginTop: Math.max(16, btnGap) }]}
          onPress={() => void goCreate("device-only")}
        >
          Continue without passkey
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      <View style={styles.footerChips}>
        <Pressable
          style={styles.chip}
          onPress={() => void openPairInfo()}
          accessibilityRole="button"
          accessibilityLabel="pair"
          accessibilityHint={pairBusy ? pairStatus : "Pair account with Bluetooth"}
        >
          <BluetoothIcon />
          <Text style={styles.chipText}>pair</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => void goCreate("restore")}
          accessibilityRole="button"
          accessibilityLabel="Restore options"
        >
          <Text style={styles.chipText}>Restore options</Text>
        </Pressable>
      </View>

      <InteractiveBottomSheet
        open={pairInfoOpen}
        onDismiss={() => setPairInfoOpen(false)}
        visibleFraction={0.58}
        fitContent
        portal
      >
        <Text style={styles.sheetTitle}>Pair account with Bluetooth</Text>
        <Text style={[styles.sheetBody, { paddingBottom: sheetBottomPad }]}>
          A logged-in Basic phone can approve pairing over Bluetooth and move your
          wallets here. Grant Bluetooth permission when prompted so this phone can
          advertise and receive. Nothing is shown in cleartext. Passkeys are not
          transferred; enable Backup afterward if the other phone did not already
          have Nostr or Home backup on.
        </Text>
      </InteractiveBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    // Penpot buttons: x=28, w=334 on 390 → 28px side inset
    paddingHorizontal: 28,
  },
  logoWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  tagline: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 19, // ~1.35 × 14
  },
  primaryBtn: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    minHeight: PENPOT.btnH,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: "#000000",
  },
  textLink: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
    paddingVertical: 8,
  },
  footerChips: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    paddingBottom: 8,
  },
  chip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
  sheetTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 10,
  },
  sheetBody: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 18,
  },
});
