# Basic push notifier (sidecar)

Small always-on service that sits **beside** `relay.davidcoen.it` (strfry). It watches **Nostr kind 1059** gift-wraps for registered npubs and sends an **opaque** Android FCM tray notification so Basic can wake when force-stopped.

Classic Arkade receives are **not** watched here — those stay catch-up-on-open only.

## Security model

- App sends `{ npub, fcmToken, appId, platform, relays? }` — **never an nsec**.
- Sidecar only learns “this npub got a new 1059” (relay metadata). It does **not** decrypt gift-wraps.
- FCM payload is opaque: title/body like `Basic` / `New Pay message`, plus data `basic.wake=nostr`.
- Never sats, memo, or addresses in the notification.
- Register/unregister require header `X-Basic-Notifier-Key` (shared install secret).

## API

### `GET /health`

```json
{ "ok": true, "registrations": 1, "subscriptions": 1, "fcmReady": true, "homeRelay": "wss://relay.davidcoen.it" }
```

### `POST /v1/register`

Headers: `Content-Type: application/json`, `X-Basic-Notifier-Key: <secret>`

```json
{
  "npub": "npub1…",
  "fcmToken": "<fcm device token>",
  "appId": "app.basic.wallet",
  "platform": "android",
  "relays": ["wss://relay.davidcoen.it"]
}
```

Replaces any prior registration for that npub (or that token).

### `DELETE /v1/register`

Same auth header. Body: `{ "npub": "…" }` and/or `{ "fcmToken": "…" }`.

## Deploy next to strfry

1. Complete FCM setup — see [`ops/fcm-eas-setup.md`](./ops/fcm-eas-setup.md). **Blocked** until David’s Firebase project provides `google-services.json` + service-account JSON.
2. Configure free kinds on the relay — see [`ops/relay-free-kinds.md`](./ops/relay-free-kinds.md). Templates only until SSH to the live host.
3. On the host:

```bash
cd /opt/basic-notifier   # or beside strfry compose
cp .env.example .env     # fill NOTIFIER_APP_KEY + FCM path
docker compose -f docker-compose.example.yml up -d --build
```

4. Wire nginx TLS — [`ops/nginx-notifier.conf.example`](./ops/nginx-notifier.conf.example).
5. Point the app at the public URL (`EXPO_PUBLIC_BASIC_NOTIFIER_URL`) and the same app key.

## Local dev

```bash
cd notifier
cp .env.example .env
npm install
npm run dev
```

Without FCM credentials, register still works; sends log failures and `/health` shows `fcmReady: false`.

## Out of scope (v1)

- iOS / APNs
- UnifiedPush
- Watching Arkade ASP / balances
- Decrypting gift-wrap content
