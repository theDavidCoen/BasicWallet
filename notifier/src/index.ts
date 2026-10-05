import express from "express";
import { nip19 } from "nostr-tools";
import { initFcm, fcmStatus } from "./fcm.js";
import { GiftWrapWatcher } from "./nostrWatch.js";
import { RegistrationStore } from "./store.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const STORE_PATH =
  process.env.STORE_PATH || "./data/registrations.json";
const HOME_RELAY =
  process.env.HOME_RELAY?.trim() || "wss://relay.davidcoen.it";
const COALESCE_MS = Number(process.env.COALESCE_MS || 5000);
const REGISTER_RATE_PER_MIN = Number(process.env.REGISTER_RATE_PER_MIN || 30);
const APP_KEY = process.env.NOTIFIER_APP_KEY?.trim() || "";

const store = new RegistrationStore(STORE_PATH);
const watcher = new GiftWrapWatcher(store, {
  homeRelay: HOME_RELAY,
  coalesceMs: COALESCE_MS,
});

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: express.Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0]!.trim();
  return req.socket.remoteAddress || "unknown";
}

function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > REGISTER_RATE_PER_MIN) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }
  next();
}

function requireAppKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!APP_KEY) {
    res.status(503).json({ error: "notifier_key_not_configured" });
    return;
  }
  const header = req.header("x-basic-notifier-key") || "";
  if (header !== APP_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function decodeNpub(npub: string): { npub: string; pubkey: string } | null {
  try {
    const decoded = nip19.decode(npub.trim());
    if (decoded.type !== "npub") return null;
    const pubkey = String(decoded.data).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
    return { npub: npub.trim(), pubkey };
  } catch {
    return null;
  }
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => {
  const fcm = fcmStatus();
  res.json({
    ok: true,
    service: "basic-push-notifier",
    homeRelay: HOME_RELAY,
    registrations: store.list().length,
    ...watcher.stats(),
    fcmReady: fcm.ready,
    fcmReason: fcm.ready ? undefined : fcm.reason,
  });
});

app.post("/v1/register", rateLimit, requireAppKey, (req, res) => {
  const body = req.body as {
    npub?: unknown;
    fcmToken?: unknown;
    appId?: unknown;
    platform?: unknown;
    relays?: unknown;
  };
  const npubRaw = typeof body.npub === "string" ? body.npub : "";
  const fcmToken = typeof body.fcmToken === "string" ? body.fcmToken.trim() : "";
  const appId = typeof body.appId === "string" ? body.appId.trim() : "";
  const platform = typeof body.platform === "string" ? body.platform.trim() : "";
  const relays = Array.isArray(body.relays)
    ? body.relays.filter((r): r is string => typeof r === "string" && /^wss?:\/\//i.test(r)).slice(0, 8)
    : [];

  if (!fcmToken || fcmToken.length < 20 || fcmToken.length > 4096) {
    res.status(400).json({ error: "invalid_fcm_token" });
    return;
  }
  if (appId !== "app.basic.wallet") {
    res.status(400).json({ error: "invalid_app_id" });
    return;
  }
  if (platform !== "android") {
    res.status(400).json({ error: "android_only" });
    return;
  }
  const id = decodeNpub(npubRaw);
  if (!id) {
    res.status(400).json({ error: "invalid_npub" });
    return;
  }

  // One registration per identity — replace prior token for this npub.
  store.remove({ npub: id.npub });
  // Also drop this token if it was bound to another npub.
  store.remove({ fcmToken });

  const reg = {
    npub: id.npub,
    pubkey: id.pubkey,
    fcmToken,
    appId,
    platform: "android" as const,
    relays,
    updatedAt: Date.now(),
  };
  store.upsert(reg);
  watcher.ensure(reg);
  res.json({ ok: true });
});

app.delete("/v1/register", rateLimit, requireAppKey, (req, res) => {
  const body = (req.body ?? {}) as { npub?: unknown; fcmToken?: unknown };
  const npub = typeof body.npub === "string" ? body.npub.trim() : undefined;
  const fcmToken = typeof body.fcmToken === "string" ? body.fcmToken.trim() : undefined;
  if (!npub && !fcmToken) {
    res.status(400).json({ error: "npub_or_token_required" });
    return;
  }
  if (npub) {
    const id = decodeNpub(npub);
    if (!id) {
      res.status(400).json({ error: "invalid_npub" });
      return;
    }
  }
  const removed = store.remove({ npub, fcmToken });
  // Drop orphaned WS subs after store mutation.
  watcher.syncFromStore();
  res.json({ ok: true, removed });
});

const fcmInit = initFcm();
if (!fcmInit.ok) {
  console.warn("[notifier] FCM not ready:", fcmInit.reason);
  console.warn("[notifier] Register API still works; sends will fail until credentials are set.");
}

watcher.syncFromStore();

const server = app.listen(PORT, HOST, () => {
  console.log(`[notifier] listening on http://${HOST}:${PORT}`);
  console.log(`[notifier] home relay ${HOME_RELAY}`);
  console.log(`[notifier] registrations ${store.list().length}`);
});

function shutdown(signal: string): void {
  console.log(`[notifier] ${signal} — shutting down`);
  watcher.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
