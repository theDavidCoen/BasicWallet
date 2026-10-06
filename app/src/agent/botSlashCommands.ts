/**
 * Ask Cursor composer slash commands (/new, /stop).
 * Pure helpers — no network. Intercept in the bot thread UI only.
 */

export type BotSlashCommand = "/new" | "/stop";

export const BOT_SLASH_COMMANDS: readonly BotSlashCommand[] = [
  "/new",
  "/stop",
] as const;

/** Exact match after trim. Case-sensitive per plan preference (`/new`, `/stop`). */
export function matchBotSlashCommand(text: string): BotSlashCommand | null {
  const body = text.trim();
  if (body === "/new") return "/new";
  if (body === "/stop") return "/stop";
  return null;
}

/**
 * When the composer draft starts with `/`, return matching slash suggestions.
 * Prefix filter is case-insensitive so `/N` still suggests `/new`.
 */
export function botSlashSuggestions(draft: string): BotSlashCommand[] {
  if (!draft.startsWith("/")) return [];
  const prefix = draft.toLowerCase();
  return BOT_SLASH_COMMANDS.filter((cmd) => cmd.startsWith(prefix));
}
