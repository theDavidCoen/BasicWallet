/**
 * Cursor Cloud Agents API client (api.cursor.com).
 *
 * Default: no-repo agents, no inline mcpServers — Bitrefill/other MCPs are
 * expected to come from the user's Cursor Cloud / Dashboard configuration
 * attached to their API key. Do not inject Bitrefill keys from Basic.
 */

const API_BASE = "https://api.cursor.com";

export type CursorMe = {
  apiKeyName?: string;
  userId?: number;
  userEmail?: string;
  userFirstName?: string;
  userLastName?: string;
  createdAt?: string;
};

export type CursorAgentSummary = {
  id: string;
  name?: string;
  status?: string;
  latestRunId?: string;
  url?: string;
};

export type CursorRun = {
  id: string;
  agentId: string;
  status: string;
  result?: string;
  createdAt?: string;
  updatedAt?: string;
  durationMs?: number;
};

export type CursorApiError = {
  status: number;
  code?: string;
  message: string;
};

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function parseError(res: Response): Promise<CursorApiError> {
  let message = `Cursor API ${res.status}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as {
      message?: string;
      error?: string;
      code?: string;
    };
    if (typeof body.message === "string" && body.message) message = body.message;
    else if (typeof body.error === "string" && body.error) message = body.error;
    if (typeof body.code === "string") code = body.code;
  } catch {
    try {
      const text = await res.text();
      if (text.trim()) message = text.trim().slice(0, 280);
    } catch {
      /* */
    }
  }
  return { status: res.status, code, message };
}

export async function validateCursorApiKey(apiKey: string): Promise<CursorMe> {
  const key = apiKey.trim();
  if (!key) throw new Error("Paste a Cursor API key.");
  const res = await fetch(`${API_BASE}/v1/me`, {
    method: "GET",
    headers: authHeaders(key),
  });
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401 || res.status === 403) {
      throw new Error("Invalid Cursor API key.");
    }
    throw new Error(err.message || "Could not validate Cursor API key.");
  }
  return (await res.json()) as CursorMe;
}

/**
 * Create a no-repo Cloud Agent (omit repos + env).
 * Intentionally does NOT pass mcpServers — Dashboard MCPs preferred.
 */
export async function createNoRepoAgent(
  apiKey: string,
  promptText: string,
  opts?: { name?: string },
): Promise<{ agent: CursorAgentSummary; run: CursorRun }> {
  const body: Record<string, unknown> = {
    prompt: { text: promptText },
    name: opts?.name?.slice(0, 100) || "Basic Ask Cursor",
  };
  const res = await fetch(`${API_BASE}/v1/agents`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await parseError(res);
    throw new Error(err.message || "Failed to create Cursor agent.");
  }
  const json = (await res.json()) as {
    agent: CursorAgentSummary;
    run: CursorRun;
  };
  if (!json?.agent?.id || !json?.run?.id) {
    throw new Error("Cursor agent create returned an unexpected response.");
  }
  return json;
}

export async function createAgentFollowUpRun(
  apiKey: string,
  agentId: string,
  promptText: string,
): Promise<CursorRun> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/runs`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ prompt: { text: promptText } }),
  });
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 409) {
      throw new Error("Cursor agent is busy — try again in a moment.");
    }
    throw new Error(err.message || "Failed to send follow-up to Cursor agent.");
  }
  const json = (await res.json()) as { run: CursorRun };
  if (!json?.run?.id) {
    throw new Error("Cursor follow-up returned an unexpected response.");
  }
  return json.run;
}

export async function getAgentRun(
  apiKey: string,
  agentId: string,
  runId: string,
): Promise<CursorRun> {
  const res = await fetch(
    `${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
    { method: "GET", headers: authHeaders(apiKey) },
  );
  if (!res.ok) {
    const err = await parseError(res);
    throw new Error(err.message || "Failed to read Cursor run.");
  }
  return (await res.json()) as CursorRun;
}

const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

/**
 * Poll Get A Run until terminal. Prefer poll over SSE for React Native v1.
 * Spike gap: Dashboard MCP tool visibility is not verified in this client.
 */
export async function waitForRunResult(
  apiKey: string,
  agentId: string,
  runId: string,
  opts?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<CursorRun> {
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const intervalMs = opts?.intervalMs ?? 2_500;
  const started = Date.now();
  let last: CursorRun | null = null;
  while (Date.now() - started < timeoutMs) {
    if (opts?.signal?.aborted) throw new Error("Cancelled.");
    last = await getAgentRun(apiKey, agentId, runId);
    if (TERMINAL.has((last.status || "").toUpperCase())) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    last
      ? `Cursor agent timed out (last status: ${last.status}).`
      : "Cursor agent timed out.",
  );
}

/**
 * Start or continue a conversation: reuse stored agentId when possible,
 * otherwise create a fresh no-repo agent. Never injects mcpServers.
 */
export async function runCursorPrompt(opts: {
  apiKey: string;
  promptText: string;
  existingAgentId?: string | null;
  timeoutMs?: number;
}): Promise<{ agentId: string; run: CursorRun; resultText: string }> {
  const { apiKey, promptText } = opts;
  let agentId = opts.existingAgentId?.trim() || "";
  let run: CursorRun;

  if (agentId) {
    try {
      run = await createAgentFollowUpRun(apiKey, agentId, promptText);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Stale / archived agent — fall back to a new no-repo session.
      if (/404|not found|archived|gone/i.test(msg)) {
        agentId = "";
        const created = await createNoRepoAgent(apiKey, promptText);
        agentId = created.agent.id;
        run = created.run;
      } else {
        throw e;
      }
    }
  } else {
    const created = await createNoRepoAgent(apiKey, promptText);
    agentId = created.agent.id;
    run = created.run;
  }

  const finished = await waitForRunResult(apiKey, agentId, run.id, {
    timeoutMs: opts.timeoutMs,
  });
  const status = (finished.status || "").toUpperCase();
  if (status !== "FINISHED") {
    throw new Error(
      finished.result?.trim() ||
        `Cursor agent ended with status ${finished.status || "unknown"}.`,
    );
  }
  return {
    agentId,
    run: finished,
    resultText: typeof finished.result === "string" ? finished.result : "",
  };
}
