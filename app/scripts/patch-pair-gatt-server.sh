#!/usr/bin/env bash
# Inject BasicPairGattServer into the gitignored Expo android/ tree.
# app/android/ is not committed; release builds must re-apply this after prebuild.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/app/native/pair-gatt"
JAVA_DIR="$ROOT/app/android/app/src/main/java/app/basic/wallet"
MAIN_APP="$JAVA_DIR/MainApplication.kt"
PROGUARD="$ROOT/app/android/app/proguard-rules.pro"

if [[ ! -d "$ROOT/app/android" ]]; then
  echo "android/ missing; skip pair GATT patch" >&2
  exit 0
fi

if [[ ! -f "$SRC/PairGattServerModule.kt" || ! -f "$SRC/PairGattServerPackage.kt" ]]; then
  echo "missing tracked GATT sources under app/native/pair-gatt" >&2
  exit 1
fi

mkdir -p "$JAVA_DIR"
cp -f "$SRC/PairGattServerModule.kt" "$JAVA_DIR/PairGattServerModule.kt"
cp -f "$SRC/PairGattServerPackage.kt" "$JAVA_DIR/PairGattServerPackage.kt"

python3 - "$MAIN_APP" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit(f"MainApplication missing: {path}")
text = path.read_text()
if "PairGattServerPackage()" in text:
    print("PairGattServerPackage already registered")
else:
    old = """        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }"""
    new = """        PackageList(this).packages.apply {
          add(PairGattServerPackage())
        }"""
    if old not in text:
        # Already customized or Expo changed the template — try a looser insert.
        needle = "PackageList(this).packages.apply {"
        if needle not in text:
            raise SystemExit("could not find PackageList block to register PairGattServerPackage")
        text = text.replace(
            needle,
            needle + "\n          add(PairGattServerPackage())",
            1,
        )
    else:
        text = text.replace(old, new, 1)
    path.write_text(text)
    print(f"registered PairGattServerPackage in {path}")
PY

if [[ -f "$PROGUARD" ]] && ! grep -q 'PairGattServer' "$PROGUARD"; then
  cat >> "$PROGUARD" <<'EOF'

# BLE pair (GATT central + custom peripheral)
-keep class com.bleplx.** { *; }
-keep class app.basic.wallet.PairGattServer** { *; }
EOF
  echo "appended PairGattServer ProGuard keeps"
fi

# Ensure connectable advertise / GATT server permissions stay present.
if [[ -x "$ROOT/app/scripts/patch-android-ble-permissions.sh" ]]; then
  bash "$ROOT/app/scripts/patch-android-ble-permissions.sh"
fi

echo "pair GATT server patched into android/"
