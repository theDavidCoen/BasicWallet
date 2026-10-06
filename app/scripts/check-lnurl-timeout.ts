/**
 * LNURL / Lightning Address fetch must time out instead of hanging Send.
 * Run: npx tsx scripts/check-lnurl-timeout.ts
 */
import {
  LNURL_FETCH_TIMEOUT_MS,
  looksLikeLightningAddress,
  looksLikeLightningPayInput,
  probeLightningPay,
} from "../src/lightning/lnPayResolve";

let failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("LNURL / Lightning Address timeout\n");

async function main() {
  assert("timeout is finite and under 20s", LNURL_FETCH_TIMEOUT_MS > 0 && LNURL_FETCH_TIMEOUT_MS <= 20_000);
  assert("donate@davidcoen.it looks like a Lightning Address", looksLikeLightningAddress("donate@davidcoen.it"));
  assert("donate@davidcoen.it is a Lightning pay input", looksLikeLightningPayInput("donate@davidcoen.it"));

  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("cloudflare-dns.com")) {
      return new Response("{}", { status: 404 });
    }
    return await new Promise<Response>((_, reject) => {
      const onAbort = () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (init?.signal?.aborted) {
        onAbort();
        return;
      }
      init?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }) as typeof fetch;
  const started = Date.now();
  try {
    await probeLightningPay("donate@davidcoen.it");
    assert("hanging LNURL-p throws", false);
  } catch (e) {
    const elapsed = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    assert(
      "hanging LNURL-p times out",
      /timed out/i.test(msg),
      msg,
    );
    assert(
      "timeout fires near LNURL_FETCH_TIMEOUT_MS",
      elapsed < LNURL_FETCH_TIMEOUT_MS + 4_000,
      `${elapsed}ms`,
    );
  } finally {
    globalThis.fetch = orig;
  }

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nall passed");
}

void main();
