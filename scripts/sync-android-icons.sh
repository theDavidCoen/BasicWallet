#!/usr/bin/env bash
# Copy app/assets launcher + splash art into android/app/src/main/res.
# Needed because `android/` is gitignored and expo prebuild / `expo run:android`
# may leave the default Android Studio grid splash + white background until this runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/app/assets"
RES="$ROOT/app/android/app/src/main/res"
SPLASH_SRC="$ASSETS/android-splash"

ICON="$ASSETS/icon.png"
FG="$ASSETS/android-icon-foreground.png"
BG="$ASSETS/android-icon-background.png"
MONO="$ASSETS/android-icon-monochrome.png"

for f in "$ICON" "$FG" "$BG" "$MONO"; do
  [[ -f "$f" ]] || { echo "missing $f" >&2; exit 1; }
done
[[ -d "$RES" ]] || { echo "missing $RES — run expo prebuild first" >&2; exit 1; }

command -v magick >/dev/null || { echo "ImageMagick magick required" >&2; exit 1; }

# legacy launcher | adaptive layer (approx Expo densities)
sync_dens() {
  local dens="$1" legacy="$2" adapt="$3"
  local dir="$RES/mipmap-$dens"
  mkdir -p "$dir"
  magick "$ICON" -resize "${legacy}x${legacy}" "$dir/ic_launcher.webp"
  magick "$ICON" -resize "${legacy}x${legacy}" "$dir/ic_launcher_round.webp"
  magick "$BG" -resize "${adapt}x${adapt}" "$dir/ic_launcher_background.webp"
  magick "$FG" -resize "${adapt}x${adapt}" "$dir/ic_launcher_foreground.webp"
  magick "$MONO" -resize "${adapt}x${adapt}" "$dir/ic_launcher_monochrome.webp"
}

sync_dens mdpi 48 108
sync_dens hdpi 72 162
sync_dens xhdpi 96 216
sync_dens xxhdpi 144 324
sync_dens xxxhdpi 192 432

echo "synced launcher icons from app/assets → mipmap-*"

# ---- Splash (cold start Theme.App.SplashScreen) ----
# Committed density PNGs match α24 Basic wordmark on black. Do not leave Expo's
# white adaptive-icon grid as splashscreen_logo.
for dens in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  src="$SPLASH_SRC/splashscreen_logo-$dens.png"
  [[ -f "$src" ]] || { echo "missing $src" >&2; exit 1; }
  mkdir -p "$RES/drawable-$dens"
  cp -a "$src" "$RES/drawable-$dens/splashscreen_logo.png"
done
echo "synced splash logos from app/assets/android-splash → drawable-*/splashscreen_logo.png"

COLORS="$RES/values/colors.xml"
STYLES="$RES/values/styles.xml"
[[ -f "$COLORS" ]] || { echo "missing $COLORS" >&2; exit 1; }
[[ -f "$STYLES" ]] || { echo "missing $STYLES" >&2; exit 1; }

python3 - "$COLORS" "$STYLES" <<'PY'
from pathlib import Path
import re
import sys

colors = Path(sys.argv[1])
text = colors.read_text()
text = re.sub(
    r'(<color name="splashscreen_background">)[^<]+(</color>)',
    r"\1#000000\2",
    text,
    count=1,
)
text = re.sub(
    r'(<color name="iconBackground">)[^<]+(</color>)',
    r"\1#0D0D0D\2",
    text,
    count=1,
)
colors.write_text(text)

styles = Path(sys.argv[2])
st = styles.read_text()
# Ensure Android 12+ splash uses black background (not system / white default).
if "windowSplashScreenBackground" not in st:
    st = st.replace(
        '<item name="android:windowBackground">@drawable/splashscreen_logo</item>',
        '<item name="android:windowBackground">@drawable/splashscreen_logo</item>\n'
        '    <item name="android:windowSplashScreenBackground">@color/splashscreen_background</item>',
        1,
    )
    styles.write_text(st)
print("patched splash colors/styles → black background")
PY

echo "synced Basic splash branding (black + wordmark)"
