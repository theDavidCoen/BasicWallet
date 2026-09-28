#!/usr/bin/env bash
# Modernize react-native-ble-advertiser for AGP 8 / compileSdk 35.
# Upstream uses a typo package name (bleavertiser) that breaks RN autolinking.
# Also:
#  - scanByService NPE (filters=null then .add)
#  - advertise DATA_TOO_LARGE: manuf+128-bit UUID exceeds 31-byte legacy AD;
#    put manuf in primary AD and service UUID in scan response only.
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

if [[ -f "$MODULE_JAVA" ]]; then
  python3 - "$MODULE_JAVA" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
changed = False

# --- scanByService null-filters NPE ---
old_scan = """        List<ScanFilter> filters = new ArrayList<>();
        if (manufacturerPayload == null)
            filters = null;
        if (manufacturerPayload != null)
            filters.add(new ScanFilter.Builder().setManufacturerData(companyId, toByteArray(manufacturerPayload)).build());
        if (uid != null) 
            filters.add(new ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(uid)).build());
        
        mScanner.startScan(filters, scanSettings, mScannerCallback);"""
new_scan = """        List<ScanFilter> filters = new ArrayList<>();
        // Non-empty manuf payload → filter. Empty array → no manuf filter (open / company
        // match done in JS). Never assign filters=null before .add().
        if (manufacturerPayload != null && manufacturerPayload.size() > 0)
            filters.add(new ScanFilter.Builder().setManufacturerData(companyId, toByteArray(manufacturerPayload)).build());
        if (uid != null)
            filters.add(new ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(uid)).build());
        if (filters.isEmpty())
            filters = null;

        mScanner.startScan(filters, scanSettings, mScannerCallback);"""
if old_scan in text:
    text = text.replace(old_scan, new_scan, 1)
    changed = True
    print("patched scanByService null-filters NPE")
elif "manufacturerPayload.size() > 0" in text:
    print("scan filter logic already patched")
elif "if (filters.isEmpty())" in text:
    # Mid-state from α35: still null-safe but treats empty manuf as a filter.
    mid = """        List<ScanFilter> filters = new ArrayList<>();
        if (manufacturerPayload != null)
            filters.add(new ScanFilter.Builder().setManufacturerData(companyId, toByteArray(manufacturerPayload)).build());
        if (uid != null)
            filters.add(new ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(uid)).build());
        // Empty filter list → pass null (scan all). Never null the list before .add().
        if (filters.isEmpty())
            filters = null;

        mScanner.startScan(filters, scanSettings, mScannerCallback);"""
    if mid in text:
        text = text.replace(mid, new_scan, 1)
        changed = True
        print("upgraded scan filter logic (empty manuf → open scan)")
    else:
        print("scanByService NPE already patched (variant)")
else:
    raise SystemExit(f"scan() filter block not found in {path}")

# --- advertise: manuf in primary AD, service UUID in scan response (≤31 bytes) ---
old_build = """    private AdvertiseData buildAdvertiseData(ParcelUuid uuid, byte[] payload, ReadableMap options) {
        AdvertiseData.Builder dataBuilder = new AdvertiseData.Builder();

        if (options != null && options.hasKey("includeDeviceName")) 
            dataBuilder.setIncludeDeviceName(options.getBoolean("includeDeviceName"));
        
         if (options != null && options.hasKey("includeTxPowerLevel")) 
            dataBuilder.setIncludeTxPowerLevel(options.getBoolean("includeTxPowerLevel"));
        
        dataBuilder.addManufacturerData(companyId, payload);
        dataBuilder.addServiceUuid(uuid);
        return dataBuilder.build();
    }"""
new_build = """    private AdvertiseData buildAdvertiseData(ParcelUuid uuid, byte[] payload, ReadableMap options) {
        // Primary AD: manufacturer payload only (legacy 31-byte limit).
        // Service UUID goes in scan response — packing both in primary AD
        // overflows and fails with ADVERTISE_FAILED_DATA_TOO_LARGE (MIUI/Xiaomi).
        AdvertiseData.Builder dataBuilder = new AdvertiseData.Builder();

        if (options != null && options.hasKey("includeDeviceName"))
            dataBuilder.setIncludeDeviceName(options.getBoolean("includeDeviceName"));

        if (options != null && options.hasKey("includeTxPowerLevel"))
            dataBuilder.setIncludeTxPowerLevel(options.getBoolean("includeTxPowerLevel"));

        dataBuilder.addManufacturerData(companyId, payload);
        return dataBuilder.build();
    }

    private AdvertiseData buildScanResponse(ParcelUuid uuid) {
        AdvertiseData.Builder scanResponse = new AdvertiseData.Builder();
        scanResponse.addServiceUuid(uuid);
        return scanResponse.build();
    }"""
if old_build in text:
    text = text.replace(old_build, new_build, 1)
    changed = True
    print("patched buildAdvertiseData (manuf-only primary AD)")
elif "buildScanResponse" in text:
    print("advertise size split already patched")
else:
    raise SystemExit(f"buildAdvertiseData block not found in {path}")

old_start = """        AdvertiseSettings settings = buildAdvertiseSettings(options);
        AdvertiseData data = buildAdvertiseData(ParcelUuid.fromString(uid), toByteArray(payload), options);

        tempAdvertiser.startAdvertising(settings, data, tempCallback);"""
new_start = """        AdvertiseSettings settings = buildAdvertiseSettings(options);
        ParcelUuid parcelUuid = ParcelUuid.fromString(uid);
        AdvertiseData data = buildAdvertiseData(parcelUuid, toByteArray(payload), options);
        AdvertiseData scanResponse = buildScanResponse(parcelUuid);

        tempAdvertiser.startAdvertising(settings, data, scanResponse, tempCallback);"""
if old_start in text:
    text = text.replace(old_start, new_start, 1)
    changed = True
    print("patched startAdvertising to use scanResponse for service UUID")
elif "buildScanResponse(parcelUuid)" in text:
    print("startAdvertising scanResponse already patched")
else:
    raise SystemExit(f"startAdvertising block not found in {path}")

if changed:
    path.write_text(text)
print(f"ble-advertiser java patches applied ({path})")
PY
fi

echo "patched ble-advertiser android (sdk + package + scan NPE + AD size)"
