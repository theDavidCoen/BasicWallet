#!/usr/bin/env bash
# Ensure Android 12+ BLE runtime permissions are in the app manifest.
# app/android/ is gitignored (expo prebuild output); app.json permissions alone
# do not always land in a long-lived android/ tree, so release builds patch here.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="$ROOT/app/android/app/src/main/AndroidManifest.xml"

if [[ ! -f "$MANIFEST" ]]; then
  echo "AndroidManifest missing; skip BLE permission patch" >&2
  exit 0
fi

python3 - "$MANIFEST" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
if "android.permission.BLUETOOTH_SCAN" in text:
    print("BLE runtime permissions already present")
    raise SystemExit(0)

block = """  <!-- BLE pair (Android 12+ runtime). neverForLocation: scan nearby ads without location. -->
  <uses-permission
    android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation"
    tools:targetApi="s"/>
  <uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
  <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE"/>
"""

needle = '  <uses-permission android:name="android.permission.CAMERA"/>'
if needle not in text:
    # Fallback: insert right after <manifest ...>
    text2, n = __import__("re").subn(
        r"(<manifest\b[^>]*>\s*)",
        r"\1" + block,
        text,
        count=1,
    )
    if n != 1:
        raise SystemExit(f"could not patch {path}")
    path.write_text(text2)
else:
    path.write_text(text.replace(needle, block + needle, 1))

print(f"patched BLE runtime permissions into {path}")
PY
