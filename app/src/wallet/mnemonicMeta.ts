import AsyncStorage from "@react-native-async-storage/async-storage";

const SOURCE_KEY = "basic.wallet.mnemonic.source";

export type MnemonicSource = "passkey-prf" | "dev-csprng" | "device-only";

/** Non-secret metadata only (not the mnemonic). */
export async function setMnemonicSource(source: MnemonicSource): Promise<void> {
  await AsyncStorage.setItem(SOURCE_KEY, source);
}

export async function getMnemonicSource(): Promise<MnemonicSource | null> {
  const v = await AsyncStorage.getItem(SOURCE_KEY);
  if (v === "passkey-prf" || v === "dev-csprng" || v === "device-only") return v;
  return null;
}
