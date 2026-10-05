/**
 * Activate / disable Cursor bot (Settings + factory reset / identity change).
 */

import { clearCursorAgentCredentials } from "../settings/cursorAgentCredentials";
import { upsertCursorBotContact, removeCursorBotContactAndThread } from "./botContact";
import {
  ensureBotIdentityForOwner,
  setBotEnabled,
  wipeBotIdentity,
} from "./botIdentity";
import { softPingBotReady } from "./botRunner";
import { stopBotWatch, syncBotWatchWithEnabledState } from "./botWatch";

/**
 * After a validated Cursor API key save: create bot identity, upsert contact,
 * enable watcher.
 */
export async function activateCursorBot(): Promise<{
  botNpub: string;
  ownerNpub: string;
}> {
  const meta = await ensureBotIdentityForOwner();
  upsertCursorBotContact(meta.botNpub);
  await syncBotWatchWithEnabledState();
  await softPingBotReady();
  return { botNpub: meta.botNpub, ownerNpub: meta.ownerNpub };
}

/**
 * Disable bot: stop watcher; optionally wipe nsec + remove contact/thread +
 * clear Cursor API key.
 */
export async function disableCursorBot(opts?: {
  wipeIdentity?: boolean;
  clearApiKey?: boolean;
}): Promise<void> {
  stopBotWatch();
  await setBotEnabled(false);

  if (opts?.wipeIdentity !== false) {
    removeCursorBotContactAndThread();
    await wipeBotIdentity();
  }

  if (opts?.clearApiKey) {
    await clearCursorAgentCredentials();
  }
}

/** Factory reset / identity change — full wipe of bot secrets + contact. */
export async function wipeCursorBotForReset(): Promise<void> {
  stopBotWatch();
  removeCursorBotContactAndThread();
  await wipeBotIdentity();
  await clearCursorAgentCredentials();
}
