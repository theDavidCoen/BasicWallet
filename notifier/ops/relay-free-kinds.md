# relay.davidcoen.it — free tier for Basic kinds only

**Goal:** Keep the relay **paid / restricted overall**, but allow **free write+read for kinds `1059` and `30078`** (Basic gift-wrap + addressable backup/labels/contacts), with anti-abuse rate limits. Do **not** make the whole relay free.

| Kind | Role in Basic |
| ---- | ------------- |
| **1059** | NIP-17 gift-wrap (contact share, Pay in Chat text, pay/request cards) |
| **30078** | Addressable backup / labels / contacts directory (`d` tag distinguishes use) |

## Current admission path (ops step 0)

Document how `relay.davidcoen.it` billing works **today** before changing policy. Common patterns:

1. **nginx / reverse-proxy gate** — AUTH or payment cookie before upgrading to WebSocket.
2. **strfry policy / plugin** — reject EVENT for unpaid writers.
3. **External paywall** (e.g. NIP-42 + paid allowlist).

This cloud agent does **not** have SSH to the live relay host. Ship templates below; apply on the host after mapping the live path.

## Recommended policy

1. **Paid / restricted** for all kinds other than `1059` and `30078`.
2. **Free write+read** for `1059` and `30078` only.
3. **Anti-abuse** (even on free kinds):
   - Per-pubkey EVENT rate limit (e.g. 60/min soft, 120/min hard).
   - Max event size (e.g. 64 KiB).
   - Optional **NIP-42 AUTH** so free writers are still identified pubkeys (not an open anonymous spam hole).
4. Publish the policy in relay README + in-app Advanced/Nostr copy: *“Basic event kinds free on this relay; other kinds may require payment.”*

## strfry notes

strfry’s stock config does not implement “paid except kinds X”. Typical approaches:

### A) nginx kind sniff (limited)

nginx cannot fully parse Nostr JSON frames for every case. Prefer strfry-side policy when possible. If an existing paywall sits in nginx, keep it for non-Basic traffic and allowlist paths/clients carefully — do not open the entire WS without auth.

### B) strfry write policy plugin / fork hook

If the host already uses a write-policy binary (common for paid relays), extend the allow rule:

```
# Pseudocode for the existing admission hook
function allow_event(ev, authed_pubkey):
  if ev.kind in (1059, 30078):
    if oversized(ev): reject
    if rate_limited(authed_pubkey or ev.pubkey): reject
    return allow   # free Basic kinds
  if is_paid_writer(authed_pubkey):
    return allow
  return reject_payment_required
```

### C) Dual listener (advanced)

- Public `:443` → free-only filter proxy that only forwards EVENT kinds 1059/30078 (+ REQ as needed).
- Paid writers continue on the existing authenticated path.

Prefer extending the existing hook (B) over running two full strfry instances.

## nginx reverse proxy for the **notifier** (not the relay)

Sidecar should listen on localhost; terminate TLS at nginx beside strfry:

See [`nginx-notifier.conf.example`](./nginx-notifier.conf.example).

Suggested public URL: `https://notifier.davidcoen.it` (or `https://relay.davidcoen.it/notifier/` if path-based).

## Rate-limit sketch (nginx for notifier HTTP only)

```nginx
limit_req_zone $binary_remote_addr zone=basic_notifier:10m rate=30r/m;
# inside location:
limit_req zone=basic_notifier burst=10 nodelay;
```

Relay EVENT rate limits belong in the strfry/policy layer, not only nginx.

## Ops runbook (apply on host)

1. SSH to the relay host; locate strfry unit + current paywall config; note the admission path in the host runbook.
2. Add free allow for kinds `1059` and `30078` with size + per-pubkey rate limits.
3. Deploy notifier container (see `notifier/README.md`) with FCM service account + `NOTIFIER_APP_KEY`.
4. Point nginx at the sidecar; issue TLS cert.
5. Smoke: publish 1059 without payment → accepted; publish random kind (e.g. 1) unpaid → rejected; notifier `/health` healthy.
6. Update public relay README with the free-kind sentence.
