import { getOsBiometricsStatus } from "./osBiometrics";

export type OnboardingContinueTo = "passkey" | "device-only" | "restore";

/** True when OS biometrics are off — show recommend + require PIN before create/restore. */
export async function needsOnboardingSecurityGate(): Promise<boolean> {
  const bio = await getOsBiometricsStatus();
  return !bio.available;
}
