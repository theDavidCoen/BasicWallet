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
  },
};

/** Suggestion chips for Ask Cursor (translated per locale). */
export function suggestionChipsFor(locale: AppLocale): string[] {
  const c = catalogs[locale].chat;
  return [c.chipAmazon, c.chipRemind, c.chipSpotify, c.chipStatus];
}
