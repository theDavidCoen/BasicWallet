# Translators guide (i18n)

How to add or improve languages in Basic Wallet. English (`en`) is the source of truth.

## User-facing language settings

- Open **Settings → Language**.
- Choices: **System default**, **English**, **Italiano**, **Português**.
- **System default** follows the phone language. If the OS language is not supported, the app falls back to **English**.
- Supported today: `en`, `it`, `pt` (Portuguese product code is `pt`; copy leans Brazilian where Fiat Mode uses R$ / DePix — see [`app/src/i18n/locales/pt/README.md`](../app/src/i18n/locales/pt/README.md)).

## Folder layout

```
app/src/i18n/
  catalog.ts          # imports every locale JSON + registers catalogs
  languagePrefs.ts    # system vs pinned preference + OS → locale mapping
  types.ts            # APP_LOCALES / LanguagePreference
  locales/
    en/               # source strings (edit first when adding UI copy)
      common.json
      settings.json
      home.json
      …
    it/
    pt/
```

Each locale folder has the same **namespace** JSON files (one file per feature area):

| Namespace | Typical screens |
|-----------|-----------------|
| `common` | Shared labels (Cancel, Continue, …) |
| `settings` | Settings list + Language screen |
| `home`, `send`, `receive`, `activity` | Main wallet chrome |
| `chat`, `cursor` | Chat & Pay / Ask Cursor |
| `onboarding`, `restore`, `backup` | First launch / recovery |
| `fiat`, `privacy`, `notifications`, `contacts`, `exit`, `about` | Destination settings |
| `reset`, `logs`, `pair`, `node`, `nostr`, `archived`, `arkade` | Settings destinations (reset, logs, Bluetooth pair, connected node, Nostr identity, archived wallets, Arkade hub/network/delegates) |

In code, keys look like `t("settings.language")` or `t("home.receive")` (namespace + key).

## Improving an existing language

1. Edit JSON under `app/src/i18n/locales/{locale}/`.
2. Keep **keys identical** to `en/`. Do not rename or delete keys unless you also update TypeScript call sites and every other locale.
3. Prefer natural UI length; long labels may wrap. Do **not** reintroduce length-based font shrinking (`AdaptiveText` was removed; selective adaptation may return later per string).
4. Run the app, switch Settings → Language to your locale, and spot-check Home, Send, Settings, Chat & Pay.

## Adding a new language

Example: Spanish (`es`).

1. **Copy English templates**

   ```bash
   cp -R app/src/i18n/locales/en app/src/i18n/locales/es
   ```

2. **Translate** every `*.json` value under `locales/es/` (keys stay English identifiers).

3. **Register the locale code** in `app/src/i18n/types.ts`:

   ```ts
   export const APP_LOCALES = ["en", "it", "pt", "es"] as const;
   ```

4. **Wire imports** in `app/src/i18n/catalog.ts`:
   - Import each `es/*.json` (mirror `en` / `it` / `pt` blocks).
   - Add an `es: { … }` entry to `catalogs`.

5. **OS mapping** in `app/src/i18n/languagePrefs.ts` (`resolveDeviceLocale`):
   - `isAppLocale(code)` already picks up codes listed in `APP_LOCALES`.
   - Add a `code.startsWith("es")` branch only if you need region aliases before the generic check.

6. **Language screen row** in `app/src/screens/LanguageScreen.tsx` (add a preference row + label key).

7. **Label strings** in every locale’s `settings.json` (e.g. `spanish` / display name), and ensure `settings.systemDefaultHint` still makes sense.

8. Open a PR with screenshots of Settings → Language and a couple of main screens in the new locale.

## System default behavior

| Preference | Resolved UI locale |
|------------|--------------------|
| System default | First matching OS language in `en` / `it` / `pt` (etc.), else **English** |
| English / Italiano / Português | That locale, ignoring OS |

Preference is stored in AsyncStorage (`basic.wallet.language.v1`). It is a device UI preference, not part of the wallet backup package.

## Typography / AdaptiveText

- Default: fixed theme font sizes (`Text` + theme styles).
- Do **not** add global `AdaptiveText` / length-based shrinking for new languages.
- If a specific label overflows on a small device, fix copy length or open a focused UI PR for that string later.

## PR tips for translators

- One locale (or one clear theme) per PR when possible.
- Diff should be mostly JSON under `locales/{code}/`; code changes only when registering a **new** language.
- No secrets, API keys, or Cursor credentials in locale files or README.
- Call out ambiguous English source strings in the PR description so maintainers can clarify.
- Test: System default on a device set to your language, then pin another language and switch back.

## Related docs

- End-user overview: [`how-to-use.md`](./how-to-use.md) (Language row under Settings).
- Product README: [`../README.md`](../README.md).
