/**
 * Owner text → Cursor Cloud Agents → bot reply (text and/or pay_request).
 * Serializes work so one Cursor run runs at a time.
 *
 * P0 latency: local fast-path enqueue (no relay wait), local-only working ack,
 * adaptive Cloud poll + status updates on the ack bubble.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { updateChatMessage } from "../chat/chatStore";
import { loadCursorApiKey } from "../settings/cursorAgentCredentials";
import {
  buildAgentUserPrompt,
  buildPayRequestEnvelopeFromInvoice,
  parseAgentInvoice,
  stripInvoiceJsonFromText,
} from "./agentInvoiceParse";
import {
  BOT_WORKING_ACK,
  formatWorkingAckStatus,
  takePendingLocalTurn,
  type PendingLocalTurn,
} from "./botLatencyHelpers";
import { botReplyPayRequest, botReplyText, botReplyTextLocal } from "./botReply";
import {
  isBotEnabled,
  loadStoredCursorAgentId,
  markBotChatSessionReset,
  storeCursorAgentId,
} from "./botIdentity";
import { matchBotSlashCommand } from "./botSlashCommands";
import { cancelAgentRun, runCursorPrompt } from "./cursorCloud";

export {
  BOT_WORKING_ACK,
  isBotWorkingAckBody,
  localBotTurnId,
} from "./botLatencyHelpers";

const PROCESSED_KEY = "basic.wallet.cursor.bot.processed.v1";
const PROCESSED_MAX = 400;
const STATUS_UI_MIN_MS = 1_000;

let chain: Promise<void> = Promise.resolve();
const processedWrapIds = new Set<string>();
let processedHydrated = false;

/** Local fast-path turns waiting to bridge when the gift-wrap arrives. */
const pendingLocalTurns: PendingLocalTurn[] = [];

type ActiveCloudWork = {
  controller: AbortController;
  apiKey: string;
  agentId: string | null;
  runId: string | null;
  workingAckMessageId: string | null;
  lastStatusUiAt: number;
};

let activeCloudWork: ActiveCloudWork | null = null;

/**
 * Abort in-flight poll and best-effort cancel the Cloud run.
 * Does not clear stored agentId (use resetBotCloudSession for /new).
 */
export async function cancelActiveBotCloudWork(): Promise<{
  cancelled: boolean;
}> {
  const work = activeCloudWork;
  if (!work) return { cancelled: false };
  try {
    work.controller.abort();
  } catch {
    /* */
  }
  if (work.agentId && work.runId) {
    try {
      await cancelAgentRun(work.apiKey, work.agentId, work.runId);
    } catch (e) {
      console.warn("[basic] cancelAgentRun failed", e);
    }
  }
  return { cancelled: true };
}

/**
 * Cancel in-flight work, drop stored Cloud agentId (next ask = new agent),
 * and stamp a chat session cut so relay gift-wrap catch-up cannot revive
 * the cleared Ask Cursor thread.
 */
export async function resetBotCloudSession(): Promise<void> {
  // Cut first (sync memory) so in-flight catch-up cannot race past clear.
  await markBotChatSessionReset();
  await cancelActiveBotCloudWork();
  await storeCursorAgentId(null);
}

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
  pendingLocalTurns.length = 0;
  try {
    await AsyncStorage.removeItem(PROCESSED_KEY);
  } catch {
    /* */
  }
}

/**
 * If this gift-wrap matches a local fast-path turn already enqueued/processed,
 * mark the wrap processed and skip a second Cloud run.
 * @returns true when the caller should not enqueue again.
 */
export function tryBridgeLocalBotTurn(opts: {
  body: string;
  wrapEventId: string;
  /** Kind 1059 created_at (seconds). Rejects stale same-body catch-up. */
  wrapCreatedAtSec?: number;
}): boolean {
  if (!opts.wrapEventId) return false;
  const taken = takePendingLocalTurn(pendingLocalTurns, {
    body: opts.body,
    wrapCreatedAtSec: opts.wrapCreatedAtSec,
  });
  if (!taken) return false;
  markBotWrapProcessed(opts.wrapEventId);
  // Local turn already marked / queued under local:<id> — never double-run.
  return true;
}

/**
 * Handle an owner chat.text already validated by botWatch (owner-only),
 * or enqueued immediately from sendChatText on the bot contact (P0a).
 * Does not re-ingest the owner's message (already stored as outbound).
 */
export function enqueueOwnerBotText(opts: {
  body: string;
  wrapEventId: string;
  /** Outbound local message id when enqueueing before Nostr round-trip. */
  localMessageId?: string;
}): void {
  const body = opts.body.trim();
  if (opts.localMessageId) {
    pendingLocalTurns.push({
      localId: opts.localMessageId,
      body,
      at: Date.now(),
    });
  }
  chain = chain
    .then(async () => {
      await hydrateBotProcessedWraps();
      if (wasBotWrapProcessed(opts.wrapEventId)) return;
      markBotWrapProcessed(opts.wrapEventId);
      await handleOwnerBotText(body);
    })
    .catch((e) => {
      console.warn("[basic] bot runner failed", e);
    });
}

function pushWorkingAckStatus(work: ActiveCloudWork, status: string): void {
  const id = work.workingAckMessageId;
  if (!id) return;
  const now = Date.now();
  if (now - work.lastStatusUiAt < STATUS_UI_MIN_MS) return;
  work.lastStatusUiAt = now;
  try {
    updateChatMessage(id, { bodyText: formatWorkingAckStatus(status) });
  } catch (e) {
    console.warn("[basic] working ack status update failed", e);
  }
}

async function handleOwnerBotText(bodyRaw: string): Promise<void> {
  const body = bodyRaw.trim();
  if (!body) return;
  // Safety: slash commands are UI-only; never forward to Cloud/Bitrefill.
  if (matchBotSlashCommand(body)) return;
  if (!(await isBotEnabled())) return;

  const apiKey = await loadCursorApiKey();
  if (!apiKey) {
    await botReplyText(
      "Cursor API key missing. Open Settings → Cursor agent to paste your key.",
    );
    return;
  }

  // P0b: progress ack is local-only (no gift-wrap publish).
  const ack = botReplyTextLocal(BOT_WORKING_ACK);

  const controller = new AbortController();
  const work: ActiveCloudWork = {
    controller,
    apiKey,
    agentId: null,
    runId: null,
    workingAckMessageId: ack?.messageId ?? null,
    lastStatusUiAt: 0,
  };
  activeCloudWork = work;
  pushWorkingAckStatus(work, "CREATING");

  try {
    const existingAgentId = await loadStoredCursorAgentId();
    const promptText = buildAgentUserPrompt(body);
    const { agentId, resultText } = await runCursorPrompt({
      apiKey,
      promptText,
      existingAgentId,
      signal: controller.signal,
      onRunStarted: (info) => {
        work.agentId = info.agentId;
        work.runId = info.runId;
      },
      onStatus: (status) => {
        pushWorkingAckStatus(work, status);
      },
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
    if (/cancelled/i.test(msg)) {
      // /stop or /new aborted the poll — UI shows local feedback; no Cloud error bubble.
      return;
    }
    // Never echo API keys.
    const safe = msg.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 400);
    await botReplyText(
      `I couldn’t complete that with Cursor Cloud: ${safe}\n\n` +
        "Tips: no-repo agents must be enabled for your Cursor account; Bitrefill (and other MCPs) must be attached in your Cursor Cloud / Dashboard — Basic never stores those keys.",
    );
  } finally {
    if (activeCloudWork === work) activeCloudWork = null;
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
