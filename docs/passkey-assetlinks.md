# Passkey Digital Asset Links

Live RP: **`basic.davidcoen.it`**

- Statement list: https://basic.davidcoen.it/.well-known/assetlinks.json
- Source copy in repo: [`well-known/assetlinks.json`](./well-known/assetlinks.json)
- Hosted on homelab portable (`.104`) nginx edge + Let's Encrypt
- DDNS updater: `~/scripts/update_ddns_basic.sh` on portable (webcall URL in `~/.config/basic-wallet/ddns-webcall.url`, not in git)
- Static root: `~/apps/basic-passkey-rp/` on portable

Fingerprints:

| Build | SHA-256 |
|-------|---------|
| Release (`~/.config/basic-wallet/release.keystore`) | `1D:C5:9A:35:69:CD:47:97:D1:99:17:CC:57:27:D0:3C:D0:4F:70:2E:55:BD:84:E8:B0:DF:79:3B:7D:ED:87:DD` |
| Android debug | `E0:71:7D:5D:16:5C:72:4F:74:38:78:81:C7:9B:B6:E2:56:F7:DF:E1:22:AA:FC:69:F0:9F:06:3C:AD:20:13:2D` |

After changing the release keystore, update both the live file on portable and this repo copy.
