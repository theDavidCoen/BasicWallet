/**
 * Slash parse checks (run with: npx tsx src/agent/botSlashCommands.test.ts).
 */

import {
  botSlashSuggestions,
  matchBotSlashCommand,
} from "./botSlashCommands";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(matchBotSlashCommand("/new") === "/new", "/new exact");
assert(matchBotSlashCommand("  /new  ") === "/new", "/new trim");
assert(matchBotSlashCommand("/New") === null, "/New rejected (exact)");
assert(matchBotSlashCommand("/stop") === "/stop", "/stop exact");
assert(matchBotSlashCommand("/stop please") === null, "no trailing words");
assert(matchBotSlashCommand("new") === null, "plain text");
assert(matchBotSlashCommand("") === null, "empty");

assert(
  JSON.stringify(botSlashSuggestions("/")) === JSON.stringify(["/new", "/stop"]),
  "bare slash",
);
assert(
  JSON.stringify(botSlashSuggestions("/n")) === JSON.stringify(["/new"]),
  "/n → /new",
);
assert(
  JSON.stringify(botSlashSuggestions("/st")) === JSON.stringify(["/stop"]),
  "/st → /stop",
);
assert(
  JSON.stringify(botSlashSuggestions("/N")) === JSON.stringify(["/new"]),
  "prefix case-insensitive",
);
assert(botSlashSuggestions("hello").length === 0, "no slash");
assert(botSlashSuggestions("").length === 0, "empty draft");

console.log("botSlashCommands.test.ts: ok");
