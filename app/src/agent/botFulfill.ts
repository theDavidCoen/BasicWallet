/**
 * Post-settle Bitrefill redeem delivery for Ask Cursor.
 *
 * After Confirm+bio Pay settles a bot invoice that carries invoice_id (+ token),
 * enqueue a Cursor Cloud follow-up that polls get-invoice-by-id via the user's
 * Dashboard Bitrefill MCP, then post code(s) + HTTPS redeem links into the bot thread.
 *
 * Basic never stores Bitrefill API keys — only invoice_id / invoice_access_token
 * from buy-products (already needed for get-invoice-by-id).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { findMessageByRequestId } from "../chat/chatStore";
import { bitrefillFulfillmentFromPayToJson } from "../chat/payToJson";
import { loadCursorApiKey } from "../settings/cursorAgentCredentials";
import {
  buildBitrefillFulfillPrompt,
  formatRedemptionBubble,
  parseAgentRedemption,
  stripInvoiceJsonFromText,
} from "./agentInvoiceParse";
import { CURSOR_BOT_CONTACT_ID } from "./botConstants";
import {
  isBotEnabled,
  loadStoredCursorAgentId,
  storeCursorAgentId,
} from "./botIdentity";
import { botReplyText } from "./botReply";
import { runCursorPrompt } from "./cursorCloud";

const PENDING_KEY = "basic.wallet.cursor.bot.fulfill.pending.v1";
const DONE_KEY = "basic.wallet.cursor.bot.fulfill.done.v1";
const PENDING_MAX = 40;
const DONE_MAX = 200;

export type PendingFulfill = {
  requestId: string;
  invoiceId: string;
  invoiceAccessToken?: string;
  createdAt: number;
  attempts: number;
};

let chain: Promise<void> = Promise.resolve();
let hydrated = false;
const pending = new Map<string, PendingFulfill>();
const doneIds = new Set<string>();
const inFlight = new Set<string>();

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const [pRaw, dRaw] = await Promise.all([
      AsyncStorage.getItem(PENDING_KEY),
      AsyncStorage.getItem(DONE_KEY),
    ]);
    if (pRaw) {
      const arr = JSON.parse(pRaw) as unknown;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (!item || typeof item !== "object") continue;
          const o = item as PendingFulfill;
          if (typeof o.requestId === "string" && typeof o.invoiceId === "string") {
            pending.set(o.requestId, {
              requestId: o.requestId,
              invoiceId: o.invoiceId,
              invoiceAccessToken:
                typeof o.invoiceAccessToken === "string"
                  ? o.invoiceAccessToken
                  : undefined,
              createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
              attempts: typeof o.attempts === "number" ? o.attempts : 0,
            });
          }
        }
      }
    }
    if (dRaw) {
      const arr = JSON.parse(dRaw) as unknown;
      if (Array.isArray(arr)) {
        for (const id of arr) {
          if (typeof id === "string" && id) doneIds.add(id);
        }
      }
    }
  } catch {
    /* */
  }
}

async function persistPending(): Promise<void> {
  try {
    let list = [...pending.values()].sort((a, b) => a.createdAt - b.createdAt);
    if (list.length > PENDING_MAX) list = list.slice(-PENDING_MAX);
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* */
  }
}

async function persistDone(): Promise<void> {
  try {
    let ids = [...doneIds];
    if (ids.length > DONE_MAX) ids = ids.slice(-DONE_MAX);
    await AsyncStorage.setItem(DONE_KEY, JSON.stringify(ids));
  } catch {
    /* */
  }
}

function markDone(requestId: string): void {
  doneIds.add(requestId);
  pending.delete(requestId);
  void persistDone();
  void persistPending();
}

/**
 * After a successful bot-thread Pay, schedule Bitrefill redeem follow-up.
 * No-op for human chats or when invoice_id was never attached to the card.
 */
export function enqueueBotFulfillAfterPay(opts: {
  contactId: string;
  requestId: string | null | undefined;
}): void {
  if (opts.contactId !== CURSOR_BOT_CONTACT_ID) return;
  const requestId = opts.requestId?.trim();
  if (!requestId) return;

  chain = chain
    .then(async () => {
      await hydrate();
      if (doneIds.has(requestId) || inFlight.has(requestId)) return;

      const msg = findMessageByRequestId(CURSOR_BOT_CONTACT_ID, requestId);
      const fulfillment = bitrefillFulfillmentFromPayToJson(msg?.payToJson ?? null);
      if (!fulfillment?.invoiceId) {
        // No ids on the card — cannot poll without inventing Bitrefill keys.
        return;
      }

      const existing = pending.get(requestId);
      const job: PendingFulfill = existing ?? {
        requestId,
        invoiceId: fulfillment.invoiceId,
        invoiceAccessToken: fulfillment.invoiceAccessToken,
        createdAt: Date.now(),
        attempts: 0,
      };
      // Prefer freshly parsed token if payToJson gained fields.
      job.invoiceId = fulfillment.invoiceId;
      if (fulfillment.invoiceAccessToken) {
        job.invoiceAccessToken = fulfillment.invoiceAccessToken;
      }
      pending.set(requestId, job);
      await persistPending();

      await botReplyText(
        "Payment sent. Fetching your redemption code / link from Bitrefill…",
      );
      await runFulfillJob(job);
    })
    .catch((e) => {
      console.warn("[basic] bot fulfill enqueue failed");
      if (__DEV__) console.warn(e);
    });
}

/** Resume unfinished fulfills after bot watch starts / app resume. */
export function resumePendingBotFulfills(): void {
  chain = chain
    .then(async () => {
      await hydrate();
      if (!(await isBotEnabled())) return;
      const jobs = [...pending.values()].filter((j) => !doneIds.has(j.requestId));
      for (const job of jobs) {
        if (inFlight.has(job.requestId)) continue;
        await runFulfillJob(job);
      }
    })
    .catch((e) => {
      console.warn("[basic] bot fulfill resume failed");
      if (__DEV__) console.warn(e);
    });
}

export async function clearBotFulfillState(): Promise<void> {
  pending.clear();
  doneIds.clear();
  hydrated = true;
  try {
    await AsyncStorage.multiRemove([PENDING_KEY, DONE_KEY]);
  } catch {
    /* */
  }
}

async function runFulfillJob(job: PendingFulfill): Promise<void> {
  if (doneIds.has(job.requestId) || inFlight.has(job.requestId)) return;
  if (!(await isBotEnabled())) return;

  const apiKey = await loadCursorApiKey();
  if (!apiKey) {
    await botReplyText(
      "Paid, but I need your Cursor API key (Settings → Cursor agent) to fetch the Bitrefill code.",
    );
    return;
  }

  inFlight.add(job.requestId);
  job.attempts += 1;
  pending.set(job.requestId, job);
  await persistPending();

  try {
    const existingAgentId = await loadStoredCursorAgentId();
    const promptText = buildBitrefillFulfillPrompt({
      invoiceId: job.invoiceId,
      invoiceAccessToken: job.invoiceAccessToken,
    });
    // Longer timeout: agent may poll get-invoice-by-id until complete.
    const { agentId, resultText } = await runCursorPrompt({
      apiKey,
      promptText,
      existingAgentId,
      timeoutMs: 300_000,
    });
    await storeCursorAgentId(agentId);

    const red = parseAgentRedemption(resultText);
    if (red && red.orders.length > 0) {
      await botReplyText(formatRedemptionBubble(red));
      markDone(job.requestId);
      return;
    }
    if (red && /complete/i.test(red.status) && red.orders.length === 0) {
      await botReplyText(formatRedemptionBubble(red));
      markDone(job.requestId);
      return;
    }

    const prose = stripInvoiceJsonFromText(resultText).trim();
    if (prose) {
      await botReplyText(prose.slice(0, 2000));
    } else {
      await botReplyText(
        "Bitrefill hasn’t returned a code yet. Ask me to “check status of my last Bitrefill order” in a minute, or open Bitrefill.",
      );
    }
    // Keep pending for resume if still incomplete (bounded attempts).
    if (job.attempts >= 5) {
      markDone(job.requestId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const safe = msg.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 280);
    await botReplyText(
      `Couldn’t fetch redemption yet (${safe}). I’ll retry when the app is open, or ask me to check Bitrefill status.`,
    );
    if (job.attempts >= 5) {
      markDone(job.requestId);
    }
  } finally {
    inFlight.delete(job.requestId);
  }
}
