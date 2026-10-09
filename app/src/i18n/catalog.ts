import type { AppLocale } from "./types";

import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import enHome from "./locales/en/home.json";
import enChat from "./locales/en/chat.json";
import enSend from "./locales/en/send.json";
import enReceive from "./locales/en/receive.json";
import enOnboarding from "./locales/en/onboarding.json";
import enActivity from "./locales/en/activity.json";
import enCursor from "./locales/en/cursor.json";
import enAbout from "./locales/en/about.json";
import enFiat from "./locales/en/fiat.json";
import enPrivacy from "./locales/en/privacy.json";
import enNotifications from "./locales/en/notifications.json";
import enContacts from "./locales/en/contacts.json";
import enBackup from "./locales/en/backup.json";
import enExit from "./locales/en/exit.json";
import enRestore from "./locales/en/restore.json";
import enReset from "./locales/en/reset.json";
import enLogs from "./locales/en/logs.json";
import enPair from "./locales/en/pair.json";
import enNode from "./locales/en/node.json";
import enNostr from "./locales/en/nostr.json";
import enArchived from "./locales/en/archived.json";
import enArkade from "./locales/en/arkade.json";

import itCommon from "./locales/it/common.json";
import itSettings from "./locales/it/settings.json";
import itHome from "./locales/it/home.json";
import itChat from "./locales/it/chat.json";
import itSend from "./locales/it/send.json";
import itReceive from "./locales/it/receive.json";
import itOnboarding from "./locales/it/onboarding.json";
import itActivity from "./locales/it/activity.json";
import itCursor from "./locales/it/cursor.json";
import itAbout from "./locales/it/about.json";
import itFiat from "./locales/it/fiat.json";
import itPrivacy from "./locales/it/privacy.json";
import itNotifications from "./locales/it/notifications.json";
import itContacts from "./locales/it/contacts.json";
import itBackup from "./locales/it/backup.json";
import itExit from "./locales/it/exit.json";
import itRestore from "./locales/it/restore.json";
import itReset from "./locales/it/reset.json";
import itLogs from "./locales/it/logs.json";
import itPair from "./locales/it/pair.json";
import itNode from "./locales/it/node.json";
import itNostr from "./locales/it/nostr.json";
import itArchived from "./locales/it/archived.json";
import itArkade from "./locales/it/arkade.json";

import ptCommon from "./locales/pt/common.json";
import ptSettings from "./locales/pt/settings.json";
import ptHome from "./locales/pt/home.json";
import ptChat from "./locales/pt/chat.json";
import ptSend from "./locales/pt/send.json";
import ptReceive from "./locales/pt/receive.json";
import ptOnboarding from "./locales/pt/onboarding.json";
import ptActivity from "./locales/pt/activity.json";
import ptCursor from "./locales/pt/cursor.json";
import ptAbout from "./locales/pt/about.json";
import ptFiat from "./locales/pt/fiat.json";
import ptPrivacy from "./locales/pt/privacy.json";
import ptNotifications from "./locales/pt/notifications.json";
import ptContacts from "./locales/pt/contacts.json";
import ptBackup from "./locales/pt/backup.json";
import ptExit from "./locales/pt/exit.json";
import ptRestore from "./locales/pt/restore.json";
import ptReset from "./locales/pt/reset.json";
import ptLogs from "./locales/pt/logs.json";
import ptPair from "./locales/pt/pair.json";
import ptNode from "./locales/pt/node.json";
import ptNostr from "./locales/pt/nostr.json";
import ptArchived from "./locales/pt/archived.json";
import ptArkade from "./locales/pt/arkade.json";

export type LocaleBundle = {
  common: typeof enCommon;
  settings: typeof enSettings;
  home: typeof enHome;
  chat: typeof enChat;
  send: typeof enSend;
  receive: typeof enReceive;
  onboarding: typeof enOnboarding;
  activity: typeof enActivity;
  cursor: typeof enCursor;
  about: typeof enAbout;
  fiat: typeof enFiat;
  privacy: typeof enPrivacy;
  notifications: typeof enNotifications;
  contacts: typeof enContacts;
  backup: typeof enBackup;
  exit: typeof enExit;
  restore: typeof enRestore;
  reset: typeof enReset;
  logs: typeof enLogs;
  pair: typeof enPair;
  node: typeof enNode;
  nostr: typeof enNostr;
  archived: typeof enArchived;
  arkade: typeof enArkade;
};

export const catalogs: Record<AppLocale, LocaleBundle> = {
  en: {
    common: enCommon,
    settings: enSettings,
    home: enHome,
    chat: enChat,
    send: enSend,
    receive: enReceive,
    onboarding: enOnboarding,
    activity: enActivity,
    cursor: enCursor,
    about: enAbout,
    fiat: enFiat,
    privacy: enPrivacy,
    notifications: enNotifications,
    contacts: enContacts,
    backup: enBackup,
    exit: enExit,
    restore: enRestore,
    reset: enReset,
    logs: enLogs,
    pair: enPair,
    node: enNode,
    nostr: enNostr,
    archived: enArchived,
    arkade: enArkade,
  },
  it: {
    common: itCommon,
    settings: itSettings,
    home: itHome,
    chat: itChat,
    send: itSend,
    receive: itReceive,
    onboarding: itOnboarding,
    activity: itActivity,
    cursor: itCursor,
    about: itAbout,
    fiat: itFiat,
    privacy: itPrivacy,
    notifications: itNotifications,
    contacts: itContacts,
    backup: itBackup,
    exit: itExit,
    restore: itRestore,
    reset: itReset,
    logs: itLogs,
    pair: itPair,
    node: itNode,
    nostr: itNostr,
    archived: itArchived,
    arkade: itArkade,
  },
  pt: {
    common: ptCommon,
    settings: ptSettings,
    home: ptHome,
    chat: ptChat,
    send: ptSend,
    receive: ptReceive,
    onboarding: ptOnboarding,
    activity: ptActivity,
    cursor: ptCursor,
    about: ptAbout,
    fiat: ptFiat,
    privacy: ptPrivacy,
    notifications: ptNotifications,
    contacts: ptContacts,
    backup: ptBackup,
    exit: ptExit,
    restore: ptRestore,
    reset: ptReset,
    logs: ptLogs,
    pair: ptPair,
    node: ptNode,
    nostr: ptNostr,
    archived: ptArchived,
    arkade: ptArkade,
  },
};

/** Suggestion chips for Ask Cursor (translated per locale). */
export function suggestionChipsFor(locale: AppLocale): string[] {
  const c = catalogs[locale].chat;
  return [c.chipAmazon, c.chipRemind, c.chipSpotify, c.chipStatus];
}
