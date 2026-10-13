# Basic Wallet — UI kit (v1)

**Path:** `app/src/components/ui/`  
**Source of truth:** shipped Expo screens in `app/` (extract, don’t restyle).  
**Penpot:** prototyping only — never parity gate.  
**Current RC:** `0.9.7-rc.3`

## Principles

1. Pixel-parity with the reference screen before migration.
2. New hex → `theme/colors.ts` (or review bug).
3. StyleSheet locale only for layout one-off / domain chrome.
4. Domain widgets stay domain (`ScreenChrome`, sheets, chat bubbles, PIN pad).

## Primitives

| Component | Props / variants | Reference screens |
| --- | --- | --- |
| `SettingsRow` (+ `SettingsSection`) | `label`, `onPress?`, `danger?`, `disabled?`, `right?`, `hint?`, `stub?` | Settings, Arkade, Privacy, Language, Display currencies, Notifications, Delegates, Nostr Identity |
| `SectionHeader` | `children`, `first?` | Settings hub sections |
| `Button` | `primary` \| `secondary` \| `danger`; `size` `hub` (15) \| `sheet` (14); `busy?`, `disabled?`, `textStyle?`, `onPressIn?`; children string or node | Hubs, sheets, Send CTAs, backup/restore/exit steps, pair, funds sent/received, PasskeyProgress |
| `ScreenTitle` / `Caption` / `Hint` | `align?` | Hubs + sheets (with `sheetUi` style overrides) + AppLock |
| `TextField` | TextInput props + `error?` | Sheets (AddWallet, Connect*, EditWallet, ShareContact), Reset, Import nsec |
| `EmptyStateCard` | `default` \| `muted` | Terms, warnings, PayHub/ChatThread empty, Exit cards |
| `AmountKeypad` | `onKey` | Receive POS (ChatAmount / Send POS via same panel) |

## Tokens

- `colors`: + `onPrimary`, `danger`, `success`, `warning`, `link`
- `radii`: `sm` 10, `md` 12, `pill` 14
- `typography`: `fonts` + `type` presets (`caption` 14 hub / `sheetCaption` 13 sheet)
- `ui` / `sheetUi`: read from tokens; primary text → `colors.onPrimary`

## Call sites (rc.3)

| Area | Kit usage | Still local / domain |
| --- | --- | --- |
| Settings / Arkade / Privacy / Language / Display / Notifications | SettingsRow (+ SectionHeader where applicable) | About ASP KV card (not a settings list) |
| Backup / restore / export / pair / reset / remove | Button (+ ScreenTitle/Caption/Hint/TextField) | PassphraseInput, BackupPassphraseLiveRules, PIN pad digits |
| Exit wizard (prepare/fund/execute/recovery/collab) + hub | Button | ExitStepHeader chrome, progress copy |
| Wallet / node / fiat sheets | Button `size="sheet"`, TextField, ScreenTitle/Caption | Sheet engine, wallet switcher row chrome |
| Send CTAs | Button | Multi-step chrome, QR, contact pickers, amount display |
| Funds sent/received | Button | Amount/title layout |
| Home | Button Receive/Send | Balance hero, Chat&Pay teaser, badges, hist handle |
| ChatThread | ScreenTitle/Caption/Button empty; Request/Send | Header, bubbles, composer, send↑ chip |
| AppLock | ScreenTitle / Caption / Hint | Bio circle, UnlockPinPad |
| Amount keypad | `AmountKeypad` + Button in ReceivePosPanel | Amount display / unit swap / memo |
| Reminder banners | Hint CTA line | Dialog shell / pan / close × |

## Leave alone (still domain)

Chat bubbles/cards, ScreenChrome, sheet hosts (`InteractiveBottomSheet` / `InteractiveSideSheet` / `SheetHost`), AppLock bio circle, PIN pads (`SetAppPin` / `UnlockPinPad`), Home balance / Chat&Pay teaser, QR / ExpandableQrCode, sync indicators, HomeTourOverlay, passphrase rules widget, ContactPickList row chrome, Send multi-step non-CTA chrome.
