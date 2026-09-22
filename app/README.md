# Basic Wallet (app)

Expo React Native client. Product specs live in [`../prototype/docs/`](../prototype/docs/).

| Locked choice | Value |
|---------------|--------|
| Package id | `app.basic.wallet` |
| Networks | `__DEV__` → mutinynet · release → mainnet |
| Mnemonic | Android Keystore via `expo-secure-store` only |
| Seed UI | Never plaintext except gated export (`userPresence` + `FLAG_SECURE`) |

## Develop

```bash
cd app
npm install
npx expo start
```

Android device/emulator: `npx expo start --android` (needs Expo dev client or Expo Go for JS-only; **secure-store / local-auth need a dev build**).

```bash
npx expo prebuild --platform android
npx expo run:android
```

## Reproducible APK (goal)

1. Pin Exact dependency versions in `package-lock.json` (committed).
2. Document JDK / Android SDK / NDK versions used for release.
3. Prefer EAS Build with a locked image, or local `expo prebuild` + Gradle with reproducible flags.
4. Publish build recipe alongside release tags so third parties can verify the APK.

## Permissions

Declare only what features need (camera for QR when that screen ships, etc.). Do not add contacts/location/mic/tracking.

## Security checklist (scaffold)

- [x] No mnemonic in AsyncStorage
- [x] `storeMnemonic` / `loadMnemonicForCrypto` only in `src/security/mnemonicStore.ts`
- [x] No seed in UI except gated export (`ExportRecoveryPhrase` + biometrics + screen capture block)
- [x] HD `Wallet.create({ walletMode: "hd" })` + onboarding nav (Create → Terms → Ready → Home)
- [x] `__DEV__` CSPRNG path for device testing until native passkey PRF is wired
- [ ] Native WebAuthn / Credential Manager **PRF**
- [x] Persistent SDK repositories (expo-sqlite per wallet)
- [x] Export phrase screen with biometrics gate + `FLAG_SECURE` (`expo-screen-capture`)
- [x] Path C Advanced Backup (Nostr / home server local package)
- [x] Nostr identity (05d) + export/import nsec
