# Basic Wallet — UI kit (v1)

**Path:** `app/src/components/ui/`  
**Source of truth:** shipped Expo screens in `app/` (extract, don’t restyle).  
**Penpot:** prototyping only — never parity gate.

## Principles

1. Pixel-parity with the reference screen before migration.
2. New hex → `theme/colors.ts` (or review bug).
3. StyleSheet locale only for layout one-off / domain chrome.
4. Domain widgets stay domain (`ScreenChrome`, sheets, chat bubbles, PIN pad).

## Primitives

| Component | Props / variants | Reference screens |
| --- | --- | --- |
| `SettingsRow` (+ `SettingsSection`) | `label`, `onPress?`, `danger?`, `disabled?`, `right?`, `hint?`, `stub?` | Settings, Arkade Settings, Privacy, Nostr Identity |
| `SectionHeader` | `children`, `first?` | Settings hub sections |
| `Button` | `primary` \| `secondary` \| `danger`; `busy?`, `disabled?`, `textStyle?`, `onPressIn?`; children string or node | Hubs, Home Receive/Send, ChatThread actions, Onboarding continue, Exit hub, POS CTA, reminders stay text CTAs |
| `ScreenTitle` / `Caption` / `Hint` | `align?` | Hubs + AppLock + Exit + ChatThread empty |
| `TextField` | TextInput props + `error?` | SaveToContacts, Import nsec paste |
| `EmptyStateCard` | `default` \| `muted` | Terms, warning lists, PayHub/ChatThread empty, Exit cards |
| `AmountKeypad` | `onKey` | Receive POS (ChatAmount / Send POS via same panel) |

## Tokens

- `colors`: + `onPrimary`, `danger`, `success`, `warning`, `link`
- `radii`: `sm` 10, `md` 12, `pill` 14
- `typography`: `fonts` + `type` presets (`caption` 14 hub / `sheetCaption` 13 sheet)
- `ui` / `sheetUi`: read from tokens; primary text → `colors.onPrimary`

## Call sites (expanded)

| Area | Kit usage | Still local / domain |
| --- | --- | --- |
| Settings / Arkade / Privacy | SettingsRow, SectionHeader, ScreenTitle | — |
| Home | Button secondary Receive/Send (`onPressIn`, fontSize 16) | Balance, Chat&Pay entry, badges, hist handle |
| ChatThread | ScreenTitle/Caption/Button empty; EmptyStateCard; Request/Send Buttons | Header, bubbles, composer, send↑ chip |
| Onboarding create | Button + Caption (tagline) | Logo layout coords, chips, pair sheet |
| AppLock | ScreenTitle / Caption / Hint | Circular bio hit, UnlockPinPad |
| Amount keypad | `AmountKeypad` + Button CTA in ReceivePosPanel | Amount display / unit swap / memo |
| Reminder banners | Hint for CTA line; radii/fonts tokens on dialog | Dialog shell / pan / close × |
| Unilateral Exit hub | ScreenTitle, Caption, Hint, EmptyStateCard, Button | Job progress copy styles |

## Leave alone (still domain)

Chat bubbles/cards, ScreenChrome, sheet hosts, AppLock bio circle, PIN pads (`SetAppPin` / `UnlockPinPad`), Home Chat&Pay teaser layout, Send multi-step (non-POS) chrome.
