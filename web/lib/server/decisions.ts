// OpenRouter Decisions API (System One decision models; default nace-ai/drex-max).
// Request/answer shapes: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md
// Env: OPENROUTER_API_KEY (required), DECISION_MODEL, DECISIONS_URL. Server-only: the key must never reach the browser.

export type DecisionQuestion =
  | { type: "choice"; instructions?: string; criteria: Record<string, string> }
  | { type: "score"; instructions?: string; criteria: string[] }
  | { type: "noul"; instructions?: string; criteria?: { true?: string; false?: string } };

export type DecisionAnswer =
  | { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: "score"; score: number; confidence?: number; probabilities?: Record<string, number>; legend?: Record<string, string> }
  | { type: "noul"; noul: number; confidence?: number }
  | { type: "refusal" };

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** One Decisions call: every question is answered independently about the same state. */
export async function decide(
  state: unknown,
  questions: Record<string, DecisionQuestion>,
): Promise<{ answers: Record<string, DecisionAnswer>; cost: number }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const url = process.env.DECISIONS_URL || "https://openrouter.ai/api/alpha/decisions";
  const model = process.env.DECISION_MODEL || "nace-ai/drex-max";
  const body = JSON.stringify({ model, state, questions });

  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    let error = "";
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      error = `Decisions request failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    let retryAfterMs: number | undefined;
    if (res) {
      if (res.ok) {
        const json = (await res.json()) as { answers?: Record<string, DecisionAnswer>; usage?: { cost?: number } };
        return { answers: json.answers ?? {}, cost: json.usage?.cost ?? 0 };
      }
      const text = (await res.text()).slice(0, 300);
      error = `Decisions ${res.status}: ${text}`;
      const transient =
        res.status === 429 || res.status >= 500 || (res.status === 402 && text.includes("openrouter_in_flight_budget"));
      if (!transient) throw new Error(error);
      const ra = Number(res.headers.get("Retry-After"));
      if (ra > 0) retryAfterMs = ra * 1000;
    }
    if (attempt >= MAX_ATTEMPTS) throw new Error(error);
    await sleep(retryAfterMs ?? 500 * 2 ** attempt + Math.random() * 300);
  }
}
