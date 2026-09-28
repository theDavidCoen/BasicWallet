#!/usr/bin/env bash
# Modernize react-native-ble-advertiser for AGP 8 / compileSdk 35.
# Upstream uses a typo package name (bleavertiser) that breaks RN autolinking.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/node_modules/react-native-ble-advertiser/android"
TARGET="$MOD/build.gradle"
MANIFEST="$MOD/src/main/AndroidManifest.xml"
JAVA_DIR="$MOD/src/main/java/com/vitorpamplona"
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

echo "patched ble-advertiser android (sdk + package name)"
