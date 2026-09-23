#!/usr/bin/env bash
# Build a release APK (reproducible recipe). See docs/reproducible-builds.md
#
# ABI mode (env BASIC_WALLET_ABI):
#   arm64-v8a (default) — phone-sized APK (Xiaomi / Pixel / most modern devices)
#   universal           — all ABIs in one APK (optional / emulators)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
ANDROID="$APP/android"
DIST="$ROOT/dist"
VERSION="$(node -p "require('$APP/package.json').version")"
ABI_MODE="${BASIC_WALLET_ABI:-arm64-v8a}"
if [[ "$ABI_MODE" == "universal" ]]; then
  OUT_NAME="basic-wallet-${VERSION}-universal.apk"
else
  OUT_NAME="basic-wallet-${VERSION}-${ABI_MODE}.apk"
fi
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

ICON_SYNC="$ROOT/scripts/sync-android-icons.sh"
if [[ -x "$ICON_SYNC" ]]; then
  "$ICON_SYNC"
fi

if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
  export SOURCE_DATE_EPOCH
  SOURCE_DATE_EPOCH="$(git -C "$ROOT" show -s --format=%ct HEAD)"
fi

GRADLE="$ANDROID/app/build.gradle"
PROPS="$ANDROID/gradle.properties"
python3 - <<PY
from pathlib import Path
import re
p = Path("$GRADLE")
text = p.read_text()
version = "$VERSION"
abi_mode = "$ABI_MODE"

text = re.sub(r'versionCode\s+\d+', 'versionCode 1', text, count=1)
text = re.sub(r'versionName\s+"[^"]*"', f'versionName "{version}"', text, count=1)

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

# Remove prior splits / abiFilters injections
text = re.sub(
    r"\n\s*splits\s*\{\s*abi\s*\{[^}]*\}\s*\}",
    "",
    text,
    count=1,
    flags=re.S,
)
text = re.sub(
    r"\n\s*ndk\s*\{\s*abiFilters\s+\"[^\"]+\"\s*\}",
    "",
    text,
)

# RN / Expo: architectures come from gradle.properties reactNativeArchitectures
props = Path("$PROPS")
props_text = props.read_text()
if abi_mode == "universal":
    arches = "armeabi-v7a,arm64-v8a,x86,x86_64"
else:
    arches = abi_mode
if re.search(r"^reactNativeArchitectures=.*$", props_text, re.M):
    props_text = re.sub(
        r"^reactNativeArchitectures=.*$",
        f"reactNativeArchitectures={arches}",
        props_text,
        count=1,
        flags=re.M,
    )
else:
    props_text += f"\nreactNativeArchitectures={arches}\n"

# APK size knobs (android/ is gitignored; also mirrored in app.json expo-build-properties)
size_props = {
    "expo.useLegacyPackaging": "true",
    "expo.gif.enabled": "false",
    "android.enableMinifyInReleaseBuilds": "true",
    "android.enableShrinkResourcesInReleaseBuilds": "true",
    "android.enableBundleCompression": "true",
}
for key, val in size_props.items():
    if re.search(rf"^{re.escape(key)}=.*$", props_text, re.M):
        props_text = re.sub(
            rf"^{re.escape(key)}=.*$",
            f"{key}={val}",
            props_text,
            count=1,
            flags=re.M,
        )
    else:
        props_text += f"\n{key}={val}\n"

props.write_text(props_text)
print("gradle.properties reactNativeArchitectures=", arches)
print("gradle.properties size props:", ", ".join(f"{k}={v}" for k, v in size_props.items()))

if abi_mode == "universal":
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
else:
    # Also constrain packaging
    text = re.sub(
        r"(defaultConfig\s*\{)",
        r'\1\n        ndk {\n            abiFilters "' + abi_mode + '"\n        }',
        text,
        count=1,
    )

p.write_text(text)
print("patched", p, "abi=", abi_mode)
PY

mkdir -p "$DIST"
rm -rf "$ANDROID/app/build/outputs/apk/release"
cd "$ANDROID"
GRADLE_ARGS=(:app:assembleRelease --no-daemon)
if [[ "$ABI_MODE" != "universal" ]]; then
  GRADLE_ARGS+=("-PreactNativeArchitectures=${ABI_MODE}")
fi
./gradlew "${GRADLE_ARGS[@]}"

APK_SRC="$(find "$ANDROID/app/build/outputs/apk/release" -name '*.apk' ! -name '*unsigned*' | head -1)"
if [[ -z "$APK_SRC" ]]; then
  echo "No release APK found" >&2
  exit 1
fi

cp -f "$APK_SRC" "$DIST/$OUT_NAME"
(
  cd "$DIST"
  sha256sum "$OUT_NAME" > "${OUT_NAME}.sha256"
  gpg --batch --yes --local-user "$PGP_FPR" --detach-sign --armor "${OUT_NAME}.sha256" \
    || echo "WARN: PGP sign skipped — run gpg manually on ${OUT_NAME}.sha256" >&2
)

echo "OK $DIST/$OUT_NAME"
echo "SHA256 $(cut -d' ' -f1 "$DIST/${OUT_NAME}.sha256")"
ls -la "$DIST/$OUT_NAME" "$DIST/${OUT_NAME}.sha256" || true
echo "ABIs inside APK:"
unzip -l "$DIST/$OUT_NAME" | awk '/lib\/.*\.so$/ { print $4 }' | awk -F/ '{print $2}' | sort | uniq -c
