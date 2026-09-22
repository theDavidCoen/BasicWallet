/**
 * OS-level biometrics (Face ID / fingerprint), separate from Basic App PIN.
 */

import { Linking, Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";

export type OsBiometricsStatus = {
  hasHardware: boolean;
  enrolled: boolean;
  /** True when the device can satisfy LocalAuthentication with biometrics. */
  available: boolean;
};

export async function getOsBiometricsStatus(): Promise<OsBiometricsStatus> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return {
      hasHardware,
      enrolled,
      available: hasHardware && enrolled,
    };
  } catch {
    return { hasHardware: false, enrolled: false, available: false };
  }
}

/** Best-effort: open system settings so the user can enroll Face ID / fingerprint. */
export async function openOsSecuritySettings(): Promise<void> {
  try {
    if (Platform.OS === "ios") {
      await Linking.openURL("App-Prefs:PASSCODE");
      return;
    }
    // Android: general settings; biometric enrollment lives under Security.
    await Linking.openSettings();
  } catch {
    try {
      await Linking.openSettings();
    } catch {
      /* optional */
    }
  }
}
