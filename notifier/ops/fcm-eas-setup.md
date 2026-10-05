# FCM + EAS credentials (Basic closed-app push)

Android tray wake uses **FCM HTTP v1** via the notifier sidecar. The Expo app obtains a **native device push token** (`expo-notifications` → `getDevicePushTokenAsync`) and registers it with the sidecar. Expo Push Service is **not** required for this path.

## Blocker without David’s Firebase project

This repo ships **no** `google-services.json` and **no** Firebase service-account JSON. Until those exist in David’s Google Cloud / Firebase project and are wired into EAS + the sidecar host:

- The app can build with a placeholder `googleServicesFile` only after a real file is added.
- The sidecar `/health` reports `fcmReady: false`.
- Killed-app tray smoke tests **cannot** pass.

Do **not** invent or commit secret keys.

## Firebase project (one-time)

1. Create or reuse a Firebase project for Basic (`app.basic.wallet`).
2. Add an **Android** app with package name `app.basic.wallet`.
3. Download `google-services.json` → place at `app/google-services.json` (gitignored). See `app/google-services.json.example` for the expected shape — do not invent keys.
4. Project settings → Service accounts → Generate new private key → store off-repo as `firebase-service-account.json` for the sidecar only.
5. Enable **Cloud Messaging API (V1)** on the linked Google Cloud project.
6. Add to `app/app.json` under `expo.android` (omitted in-repo until a real file exists so prebuild does not fail):

```json
"googleServicesFile": "./google-services.json"
```

## Expo / EAS

1. `eas.json` profiles already produce APKs; no Expo Push project is required for FCM-native tokens.
2. For EAS Build, upload secrets (never commit):
   - File secret `GOOGLE_SERVICES_JSON` → write to `app/google-services.json` in the build job, **or** use EAS credentials UI for Android FCM.
   - Ensure `app.json` → `expo.android.googleServicesFile` = `"./google-services.json"` for that build.
3. Local release builds: copy real `google-services.json` into `app/` before `expo prebuild` / `eas build`.
4. Set EAS env `EXPO_PUBLIC_BASIC_NOTIFIER_URL` and `EXPO_PUBLIC_BASIC_NOTIFIER_KEY` to match the deployed sidecar (see app `src/notifications/config.ts`).

## Sidecar env

On the host next to strfry (`relay.davidcoen.it`):

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
export NOTIFIER_APP_KEY=<openssl rand -hex 32>
export HOME_RELAY=wss://relay.davidcoen.it
export FCM_ANDROID_PACKAGE=app.basic.wallet
```

See `notifier/.env.example`.

## Smoke checklist (after credentials)

1. Sidecar `/health` → `fcmReady: true`.
2. App Settings → Notifications **on** → Android 13+ permission → register succeeds (no UI error).
3. Force-stop Basic → publish kind **1059** gift-wrap `#p` to that npub on the home relay → tray within a few seconds.
4. Tap tray → Basic opens → Pay hub / existing gift-wrap catch-up (no second watcher).
5. Toggle **off** / Reset app → `DELETE /v1/register` → no further trays.
