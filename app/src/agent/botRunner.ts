/**
 * Owner text → Cursor Cloud Agents → bot reply (text and/or pay_request).
 * Serializes work so one Cursor run runs at a time.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadCursorApiKey } from "../settings/cursorAgentCredentials";
import {
  buildAgentUserPrompt,
  buildPayRequestEnvelopeFromInvoice,
  parseAgentInvoice,
  stripInvoiceJsonFromText,
} from "./agentInvoiceParse";
import { botReplyPayRequest, botReplyText } from "./botReply";
import {
  isBotEnabled,
  loadStoredCursorAgentId,
  storeCursorAgentId,
} from "./botIdentity";
import { runCursorPrompt } from "./cursorCloud";

const PROCESSED_KEY = "basic.wallet.cursor.bot.processed.v1";
const PROCESSED_MAX = 400;

let chain: Promise<void> = Promise.resolve();
const processedWrapIds = new Set<string>();
let processedHydrated = false;

export async function hydrateBotProcessedWraps(): Promise<void> {
  if (processedHydrated) return;
  processedHydrated = true;
  try {
    const raw = await AsyncStorage.getItem(PROCESSED_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return;
    for (const id of arr) {
      if (typeof id === "string" && id) processedWrapIds.add(id);
    }
  } catch {
    /* */
  }
}

async function persistProcessed(): Promise<void> {
  try {
    const ids = [...processedWrapIds];
    const trimmed = ids.length > PROCESSED_MAX ? ids.slice(-PROCESSED_MAX) : ids;
    if (trimmed.length !== processedWrapIds.size) {
      processedWrapIds.clear();
      for (const id of trimmed) processedWrapIds.add(id);
    }
    await AsyncStorage.setItem(PROCESSED_KEY, JSON.stringify(trimmed));
  } catch {
    /* */
  }
}

export function markBotWrapProcessed(wrapEventId: string): void {
  if (!wrapEventId) return;
  processedWrapIds.add(wrapEventId);
  void persistProcessed();
}

export function wasBotWrapProcessed(wrapEventId: string): boolean {
  return processedWrapIds.has(wrapEventId);
}

export async function clearBotProcessedWraps(): Promise<void> {
  processedWrapIds.clear();
  processedHydrated = true;
  try {
    await AsyncStorage.removeItem(PROCESSED_KEY);
  } catch {
    /* */
  }
}

/**
 * Handle an owner chat.text already validated by botWatch (owner-only).
 * Does not re-ingest the owner's message (already stored as outbound).
 */
export function enqueueOwnerBotText(opts: {
  body: string;
  wrapEventId: string;
}): void {
  chain = chain
    .then(async () => {
      await hydrateBotProcessedWraps();
      if (wasBotWrapProcessed(opts.wrapEventId)) return;
      markBotWrapProcessed(opts.wrapEventId);
      await handleOwnerBotText(opts.body);
    })
    .catch((e) => {
      console.warn("[basic] bot runner failed", e);
    });
}

async function handleOwnerBotText(bodyRaw: string): Promise<void> {
  const body = bodyRaw.trim();
  if (!body) return;
  if (!(await isBotEnabled())) return;

  const apiKey = await loadCursorApiKey();
  if (!apiKey) {
    await botReplyText(
      "Cursor API key missing. Open Settings → Cursor agent to paste your key.",
    );
    return;
  }

  await botReplyText("Working on it…");

  try {
    const existingAgentId = await loadStoredCursorAgentId();
    const promptText = buildAgentUserPrompt(body);
    const { agentId, resultText } = await runCursorPrompt({
      apiKey,
      promptText,
      existingAgentId,
    });
    await storeCursorAgentId(agentId);

    const invoice = parseAgentInvoice(resultText);
    const prose = stripInvoiceJsonFromText(resultText);
    if (prose) {
      await botReplyText(prose);
    } else if (!invoice) {
      await botReplyText(
        resultText.trim() ||
          "Done — but I didn’t get a clear reply from Cursor. Try again, or check that shopping MCPs (e.g. Bitrefill) are configured on your Cursor Dashboard.",
      );
    }
    if (invoice) {
      await botReplyPayRequest(buildPayRequestEnvelopeFromInvoice(invoice));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    // Never echo API keys.
    const safe = msg.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 400);
    await botReplyText(
      `I couldn’t complete that with Cursor Cloud: ${safe}\n\n` +
        "Tips: no-repo agents must be enabled for your Cursor account; Bitrefill (and other MCPs) must be attached in your Cursor Cloud / Dashboard — Basic never stores those keys.",
    );
  }
}

/**
 * Activate after a valid Cursor key save: identity + contact + watch are
 * started by the Settings screen / boot helper.
 */
export async function softPingBotReady(): Promise<void> {
  if (!(await isBotEnabled())) return;
  // No auto-message on activate — hub row + empty-state chips are enough.
}
