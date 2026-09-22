#!/usr/bin/env bash
# Build a Universal release APK (reproducible recipe). See docs/reproducible-builds.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
ANDROID="$APP/android"
DIST="$ROOT/dist"
VERSION="$(node -p "require('$APP/package.json').version")"
OUT_NAME="basic-wallet-${VERSION}-universal.apk"
PGP_FPR="5351632CBBF23EF29F1815ACD270A7681AE508EA"

if [[ -z "${BASIC_WALLET_STORE_FILE:-}" ]]; then
  ENVF="${HOME}/.config/basic-wallet/keystore.env"
  if [[ -f "$ENVF" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$ENVF"; set +a
  fi
fi

: "${BASIC_WALLET_STORE_FILE:?Set BASIC_WALLET_STORE_FILE or source keystore.env}"
: "${BASIC_WALLET_STORE_PASSWORD:?}"
: "${BASIC_WALLET_KEY_ALIAS:?}"
: "${BASIC_WALLET_KEY_PASSWORD:?}"

if [[ ! -d "$ANDROID" ]]; then
  echo "android/ missing — run: (cd app && npx expo prebuild --platform android)" >&2
  exit 1
fi

if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
  export SOURCE_DATE_EPOCH
  SOURCE_DATE_EPOCH="$(git -C "$ROOT" show -s --format=%ct HEAD)"
fi

GRADLE="$ANDROID/app/build.gradle"
python3 - <<PY
from pathlib import Path
import os, re
p = Path("$GRADLE")
text = p.read_text()
version = "$VERSION"
# versionName / versionCode
text = re.sub(r'versionCode\s+\d+', 'versionCode 1', text, count=1)
text = re.sub(r'versionName\s+"[^"]*"', f'versionName "{version}"', text, count=1)

# Inject release signing from env if missing
if "basicWalletRelease" not in text:
    signing_block = '''
        basicWalletRelease {
            storeFile file(System.getenv("BASIC_WALLET_STORE_FILE") ?: "MISSING")
            storePassword System.getenv("BASIC_WALLET_STORE_PASSWORD")
            keyAlias System.getenv("BASIC_WALLET_KEY_ALIAS")
            keyPassword System.getenv("BASIC_WALLET_KEY_PASSWORD")
        }
'''
    text = text.replace(
        "signingConfigs {\n        debug {",
        "signingConfigs {\n" + signing_block + "        debug {",
    )
    text = re.sub(
        r"(release\s*\{[^}]*?)signingConfig signingConfigs\.debug",
        r"\1signingConfig signingConfigs.basicWalletRelease",
        text,
        count=1,
        flags=re.S,
    )

# Universal: no ABI splits
if "enableSeparateBuildPerCPUArchitecture" not in text and "splits {" not in text:
    text = text.replace(
        "android {\n",
        """android {
    splits {
        abi {
            enable false
            reset()
            universalApk true
        }
    }
""",
        1,
    )

p.write_text(text)
print("patched", p)
PY

mkdir -p "$DIST"
cd "$ANDROID"
./gradlew :app:assembleRelease --no-daemon

APK_SRC="$(find "$ANDROID/app/build/outputs/apk/release" -name '*.apk' ! -name '*unsigned*' | head -1)"
if [[ -z "$APK_SRC" ]]; then
  echo "No release APK found" >&2
  exit 1
fi

cp -f "$APK_SRC" "$DIST/$OUT_NAME"
(
  cd "$DIST"
  sha256sum "$OUT_NAME" > "${OUT_NAME}.sha256"
  gpg --batch --yes --local-user "$PGP_FPR" --detach-sign --armor "${OUT_NAME}.sha256"
)

echo "OK $DIST/$OUT_NAME"
echo "SHA256 $(cut -d' ' -f1 "$DIST/${OUT_NAME}.sha256")"
ls -la "$DIST/$OUT_NAME" "$DIST/${OUT_NAME}.sha256" "$DIST/${OUT_NAME}.sha256.asc"
