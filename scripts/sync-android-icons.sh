#!/usr/bin/env bash
# Copy app/assets launcher art into android/app/src/main/res/mipmap-*.
# Needed because `android/` is gitignored and expo prebuild may leave the
# default Android Studio "A" icon until this runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/app/assets"
RES="$ROOT/app/android/app/src/main/res"

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
