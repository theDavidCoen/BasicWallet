/**
 * First-open Chat & Pay notification prompt — answer once, never again.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "basic.wallet.chatHub.notifPrompt.v1";

export type ChatHubNotifPromptChoice = "enable" | "deny";

export type ChatHubNotifPrompt = {
  answered: boolean;
  choice: ChatHubNotifPromptChoice | null;
  answeredAt: number;
};

const DEFAULT: ChatHubNotifPrompt = {
  answered: false,
  choice: null,
  answeredAt: 0,
};

export async function readChatHubNotifPrompt(): Promise<ChatHubNotifPrompt> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<ChatHubNotifPrompt>;
    const choice =
      parsed.choice === "enable" || parsed.choice === "deny"
        ? parsed.choice
        : null;
    return {
      answered: Boolean(parsed.answered) || choice != null,
      choice,
      answeredAt:
        typeof parsed.answeredAt === "number" ? parsed.answeredAt : 0,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export async function writeChatHubNotifPrompt(
  choice: ChatHubNotifPromptChoice,
): Promise<ChatHubNotifPrompt> {
  const next: ChatHubNotifPrompt = {
    answered: true,
    choice,
    answeredAt: Date.now(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
