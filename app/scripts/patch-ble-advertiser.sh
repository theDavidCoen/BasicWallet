#!/usr/bin/env bash
# Modernize react-native-ble-advertiser for AGP 8 / compileSdk 35.
# Upstream uses a typo package name (bleavertiser) that breaks RN autolinking.
# Also fixes scanByService NPE: filters set to null then .add(serviceUuid).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/node_modules/react-native-ble-advertiser/android"
TARGET="$MOD/build.gradle"
MANIFEST="$MOD/src/main/AndroidManifest.xml"
JAVA_DIR="$MOD/src/main/java/com/vitorpamplona"
MODULE_JAVA="$JAVA_DIR/bleadvertiser/BLEAdvertiserModule.java"
if [[ ! -f "$TARGET" ]]; then
  echo "ble-advertiser not installed; skip patch"
  exit 0
fi

cat > "$TARGET" <<'GRADLE'
apply plugin: 'com.android.library'

android {
    namespace "com.vitorpamplona.bleadvertiser"
    compileSdkVersion rootProject.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 35

    defaultConfig {
        minSdkVersion 24
        targetSdkVersion rootProject.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 35
        versionCode 1
        versionName "1.0"
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'com.facebook.react:react-native:+'
}
GRADLE

if [[ -f "$MANIFEST" ]]; then
  sed -i 's/ package="[^"]*"//' "$MANIFEST"
  sed -i 's/package="[^"]*"//' "$MANIFEST"
fi

# Fix Java package to match folder + autolinking (bleadvertiser, not bleavertiser).
if [[ -d "$JAVA_DIR/bleadvertiser" ]]; then
  sed -i 's/package com\.vitorpamplona\.bleavertiser;/package com.vitorpamplona.bleadvertiser;/' \
    "$JAVA_DIR/bleadvertiser"/*.java
fi

# Fix scanByService NPE: upstream nulls filters when manufacturerPayload is null,
# then filters.add(serviceUuid) crashes (Xiaomi/MIUI surfaces as HostFunction NPE).
if [[ -f "$MODULE_JAVA" ]]; then
  python3 - "$MODULE_JAVA" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
if "if (filters.isEmpty())" in text and "manufacturerPayload == null" not in text.split("List<ScanFilter> filters")[1][:400]:
    print("scanByService NPE already patched")
    raise SystemExit(0)

old = """        List<ScanFilter> filters = new ArrayList<>();
        if (manufacturerPayload == null)
            filters = null;
        if (manufacturerPayload != null)
            filters.add(new ScanFilter.Builder().setManufacturerData(companyId, toByteArray(manufacturerPayload)).build());
        if (uid != null) 
            filters.add(new ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(uid)).build());
        
        mScanner.startScan(filters, scanSettings, mScannerCallback);"""

new = """        List<ScanFilter> filters = new ArrayList<>();
        if (manufacturerPayload != null)
            filters.add(new ScanFilter.Builder().setManufacturerData(companyId, toByteArray(manufacturerPayload)).build());
        if (uid != null)
            filters.add(new ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(uid)).build());
        // Empty filter list → pass null (scan all). Never null the list before .add().
        if (filters.isEmpty())
            filters = null;

        mScanner.startScan(filters, scanSettings, mScannerCallback);"""

if old not in text:
    raise SystemExit(f"scan() filter block not found in {path}")
path.write_text(text.replace(old, new, 1))
print(f"patched scanByService null-filters NPE in {path}")
PY
fi

echo "patched ble-advertiser android (sdk + package name + scan NPE)"
