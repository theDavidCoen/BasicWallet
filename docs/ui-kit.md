# Basic Wallet — UI kit (v1)

**Path:** `app/src/components/ui/`  
**Source of truth:** shipped Expo screens in `app/` (extract, don’t restyle).  
**Penpot:** prototyping only — never parity gate.

## Principles

1. Pixel-parity with the reference screen before migration.
2. New hex → `theme/colors.ts` (or review bug).
3. StyleSheet locale only for one-off layout.
4. Domain widgets stay domain (`ScreenChrome`, sheets, chat bubbles).

## Primitives

| Component | Props / variants | Reference screens |
| --- | --- | --- |
| `SettingsRow` (+ `SettingsSection`) | `label`, `onPress?`, `danger?`, `disabled?`, `right?`, `hint?`, `stub?` | Settings, Arkade Settings, Privacy, Nostr Identity |
| `SectionHeader` | `children`, `first?` | Settings hub sections |
| `Button` | `primary` \| `secondary` \| `danger`, `busy?`, `disabled?` | Terms, Backup Recap, PayHub, warning hubs, SaveToContacts |
| `ScreenTitle` / `Caption` / `Hint` | `align?` | Same hubs + Ready / success beats |
| `TextField` | TextInput props + `error?` | SaveToContacts, Import nsec paste |
| `EmptyStateCard` | `default` \| `muted` | Terms cards, warning lists, PayHub empty |

## Tokens

- `colors`: + `onPrimary`, `danger`, `success`, `warning`, `link`
- `radii`: `sm` 10, `md` 12, `pill` 14
- `typography`: `fonts` + `type` presets (`caption` 14 hub / `sheetCaption` 13 sheet)
- `ui` / `sheetUi`: read from tokens; primary text → `colors.onPrimary`

## Leave alone (v1)

Home, Send, Receive/POS, ChatThread layout, Onboarding create layout, AppLock, amount keypads.
