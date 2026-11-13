// Gemini through OpenRouter's chat completions API (same OPENROUTER_API_KEY as the decision model).
// Server-only.
import type { StoreProfile } from "../types";

// Cheap, fast Gemini model: both calls sit on the live request path.
const MODEL = "google/gemini-3.5-flash-lite";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

async function chat(system: string, user: string, extra: object = {}): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is missing");
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...extra,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Store name" },
    animals: {
      type: "array",
      items: { type: "string", enum: ["dog", "cat"] },
      description: "Which of dog / cat the store clearly sells for. Empty if neither.",
    },
    price_band: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
      description: "Typical [low, high] USD price of the store's products (ignore outliers)",
    },
    audience: { type: "string", description: "Who shops here, one short sentence" },
    feel: { type: "string", description: "Positioning in a few words, e.g. 'premium, design-led'" },
    summary: { type: "string", description: "Two sentences on what the store sells and how" },
  },
  required: ["name", "animals", "price_band", "audience", "feel", "summary"],
  additionalProperties: false,
};

/** Profile a store from its product list or page text. */
export async function profileStore(url: string, storeText: string): Promise<StoreProfile> {
  const out = await chat(
    "You profile online pet stores for a merchandising tool. Use only the store content given. " +
      "If something is unclear, make the most conservative reading rather than guessing.",
    `Store URL: ${url}\n\nStore content:\n${storeText}`,
    { response_format: { type: "json_schema", json_schema: { name: "store_profile", strict: true, schema: PROFILE_SCHEMA } } },
  );
  const p = JSON.parse(out || "{}") as Omit<StoreProfile, "url">;
  const [lo, hi] = p.price_band ?? [0, 0];
  return {
    url,
    name: p.name,
    animals: (p.animals ?? []).filter((a) => a === "dog" || a === "cat"),
    price_band: [Math.min(lo, hi), Math.max(lo, hi)],
    audience: p.audience,
    feel: p.feel,
    summary: p.summary,
  };
}

const OVERVIEW_RULES = `You write the final overview for a pet-store owner deciding which product niches to stock.
Rules:
- Use ONLY the numbers, verdicts and quotes in the JSON you are given. No outside knowledge, no market claims, no invented figures.
- Cite the numbers you rely on (fit %, risk out of 4, share of products, review counts) and quote reviews only from the quotes provided.
- Say which niches to start with and which product, and which niches to avoid and why.
- Be honest about weak spots: if the data is thin or mixed, say so.
- Never mention the internal product "score". Under "Avoid", do not recommend a product to start with.
- Say shares in plain words, e.g. "sizing complaints show up for 92% of products in this niche".
- Markdown: a one-paragraph verdict, then short sections "Start with", "Maybe later" and "Avoid". Under 350 words.`;

/** Write the honest overview from the computed facts only. */
export async function writeOverview(facts: unknown): Promise<string> {
  return (await chat(OVERVIEW_RULES, JSON.stringify(facts))).trim();
}
