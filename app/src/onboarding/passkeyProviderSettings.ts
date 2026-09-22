/**
 * Open Android passkey / credential-provider settings so the user can enable
 * Google Password Manager (required for WebAuthn PRF). A third-party manager
 * as the sole preferred provider often hides GPM and may not supply PRF.
 */

import { Linking, Platform } from "react-native";

const ANDROID_INTENTS = [
  // Android 14+ passkey provider picker (stock / Pixel naming).
  "android.settings.CREDENTIAL_PROVIDER",
  // Autofill service picker — HyperOS often folds passkeys in here.
  "android.settings.REQUEST_SET_AUTOFILL_SERVICE",
];

const ANDROID_COMPONENT_URIS = [
  "intent:#Intent;component=com.android.settings/.applications.credentials.CredentialsPickerActivity;end",
  "intent:#Intent;component=com.google.android.gms/.auth.api.credentials.credman.passwordmanager.GooglePasswordManagerProxyActivity;end",
];

export async function openPasskeyProviderSettings(): Promise<boolean> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return true;
  }

  for (const action of ANDROID_INTENTS) {
    try {
      await Linking.sendIntent(action);
      return true;
    } catch {
      // try next
    }
  }

  for (const uri of ANDROID_COMPONENT_URIS) {
    try {
      const can = await Linking.canOpenURL(uri);
      if (can) {
        await Linking.openURL(uri);
        return true;
      }
    } catch {
      // try next
    }
  }

  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

export const PRF_PROVIDER_HELP =
  "Basic derives your wallet from the WebAuthn PRF extension.\n\n" +
  "Use Google Password Manager (or another provider that supports PRF).\n\n" +
  "Settings → Passwords & accounts (or Passkeys) → set Google Password Manager as preferred, then try again.";
