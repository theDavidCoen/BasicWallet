# Reproducible Android APK builds (Basic Wallet)

Goal: anyone with this repo + the documented toolchain can rebuild the same
Universal release APK (byte-identical JS/native inputs; APK signature uses the
release keystore held offline).

## Identity

| Field | Value |
|-------|--------|
| Package | `app.basic.wallet` |
| First alpha | `0.1.0-alpha.1` (Android `versionCode` 1) |
| GitHub | https://github.com/theDavidCoen/BasicWallet (private) |
| Release PGP | `5351632CBBF23EF29F1815ACD270A7681AE508EA` (David Coen \<info@davidcoen.it\>) |

Verify release artifacts:

```bash
gpg --verify dist/basic-wallet-0.1.0-alpha.1-universal.apk.sha256.asc \
             dist/basic-wallet-0.1.0-alpha.1-universal.apk.sha256
sha256sum -c dist/basic-wallet-0.1.0-alpha.1-universal.apk.sha256
```

## Toolchain (pin these)

| Tool | Version used for 0.1.0-alpha.1 |
|------|--------------------------------|
| OpenJDK | 17.x |
| Android SDK compile/target | 36 / 35 (see `app.json` expo-build-properties) |
| minSdk | 26 |
| Node | whatever `package-lock.json` was installed with (commit the lockfile) |
| Expo | ~57 (see `app/package.json`) |

Set `SOURCE_DATE_EPOCH` to the Unix time of the release git commit so archives
and some Gradle stamps stay stable:

```bash
export SOURCE_DATE_EPOCH=$(git -C /path/to/BasicWallet show -s --format=%ct HEAD)
```

## Release keystore (not in git)

Path on the builder machine (example):

- Keystore: `~/.config/basic-wallet/release.keystore`
- Env file: `~/.config/basic-wallet/keystore.env` (mode `600`)

```
BASIC_WALLET_STORE_FILE=...
BASIC_WALLET_STORE_PASSWORD=...
BASIC_WALLET_KEY_ALIAS=basic-wallet-release
BASIC_WALLET_KEY_PASSWORD=...
```

Certificate SHA-256 (public, safe to publish):

`1D:C5:9A:35:69:CD:47:97:D1:99:17:CC:57:27:D0:3C:D0:4F:70:2E:55:BD:84:E8:B0:DF:79:3B:7D:ED:87:DD`

## Build (Universal APK)

```bash
cd app
set -a; source ~/.config/basic-wallet/keystore.env; set +a
export SOURCE_DATE_EPOCH=$(git -C .. show -s --format=%ct HEAD)
../scripts/build-release-apk.sh
```

The script:

1. Syncs `versionName` / `versionCode` into `android/app/build.gradle`
2. Wires the release signing config from env (never commits secrets)
3. Disables ABI splits → one **Universal** APK
4. Runs `./gradlew :app:assembleRelease`
5. Copies APK to `dist/`, writes `.sha256`, detaches-signs with PGP `5351632C…`

Dev clients (Metro) stay on debug signing; do not install this APK over a
debug build without uninstalling first (signature mismatch).

## Icon

Launcher icon = hollow white Bitcoin **B** (same path as in-app `BasicLogo`),
tilted, on pure black — **no** “asic” wordmark. Sources:

- `app/assets/icon-mark.svg`
- `app/assets/android-icon-foreground-mark.svg`
