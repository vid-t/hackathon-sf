// Live pipeline behind POST /api/analyze and GET /api/evidence. Server-only.
// store page -> Gemini profile -> per niche (in parallel): J2 aspect weights -> SQL ranking + four-box
// -> J3 verdict -> best products -> Gemini overview from those numbers only. Cached per URL.
import type { AnalyzeResponse, NicheResult, StoreProfile } from "../types";
import { fourBox, getAspects, getEvidence, listNiches, nicheStats, rankProducts, type Niche } from "./analysis";
import { readCachedRun, writeCachedRun } from "./db";
import { decide, type DecisionAnswer, type DecisionQuestion } from "./decisions";
import { profileStore, writeOverview } from "./gemini";
import { fetchStoreText, normalizeUrl } from "./store";

export { getEvidence };

const IMPORTANCE = ["irrelevant", "minor", "moderate", "important", "critical"];
const RISK = ["very low", "low", "moderate", "high", "very high"];
const TOP_N = 5; // products the verdict model chooses `start_with` from
const BEST_MIN_FIT = 0.5;
const QUOTE_CHARS = 220;

type Profile = Omit<StoreProfile, "url">;
type Decide = (state: unknown, questions: Record<string, DecisionQuestion>) => Promise<Record<string, DecisionAnswer>>;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const shortTitle = (t: string) => (t.length > 80 ? `${t.slice(0, 77)}...` : t);

export async function analyzeStore(url: string): Promise<AnalyzeResponse> {
  const t0 = Date.now();
  const key = normalizeUrl(url);
  const cached = readCachedRun(key);
  if (cached) return JSON.parse(cached) as AnalyzeResponse;

  const niches = listNiches(); // fails fast if the offline labels are missing
  const store = await profileStore(key, await fetchStoreText(key));
  const { url: _url, ...profile } = store;

  const usage = { calls: 0, cost: 0 };
  const call: Decide = async (state, questions) => {
    const r = await decide(state, questions);
    usage.calls++;
    usage.cost += r.cost;
    return r.answers;
  };

  const results = (await Promise.all(niches.map((n) => evaluateNiche(n, profile, call)))).filter(
    (r): r is NicheResult => r !== null,
  );
  results.sort((a, b) => b.fit_prob - a.fit_prob);

  const best_products = results
    .filter((n) => n.fit_prob >= BEST_MIN_FIT && n.ranking.length)
    .map((n) => ({ ...(n.ranking.find((p) => p.asin === n.start_with) ?? n.ranking[0]), niche_id: n.id, fit: n.fit_prob }))
    .sort((a, b) => b.fit * b.score - a.fit * a.score)
    .map(({ fit: _fit, ...p }) => p);

  const overview_md = await writeOverview(await overviewFacts(profile, results));

  const result: AnalyzeResponse = {
    store,
    niches: results,
    best_products,
    overview_md,
    stats: { jev_calls: usage.calls, ms: Date.now() - t0, cost_usd: Math.round(usage.cost * 1e6) / 1e6 },
  };
  writeCachedRun(key, JSON.stringify(result));
  return result;
}

async function evaluateNiche(n: Niche, profile: Profile, call: Decide): Promise<NicheResult | null> {
  const aspects = getAspects(n.id);
  const stats = nicheStats(n.id);
  if (!aspects.length || !stats.products.length) return null; // niche not labeled yet
  const niche = n.name.toLowerCase();

  // J2: how much each aspect matters to this store's shoppers.
  const j2 = await call(
    { store: profile, niche: n.name, aspects: aspects.map((a) => a.name) },
    Object.fromEntries(
      aspects.map((a): [string, DecisionQuestion] => [
        a.key,
        { type: "score", instructions: `How much does ${a.name.toLowerCase()} matter to this store's shoppers when buying ${niche}?`, criteria: IMPORTANCE },
      ]),
    ),
  );
  const weights = Object.fromEntries(
    aspects.map((a) => {
      const ans = j2[a.key];
      return [a.key, ans?.type === "score" ? ans.score / (IMPORTANCE.length - 1) : 0.5];
    }),
  );

  const ranking = rankProducts(stats, weights);
  const four_box = fourBox(stats, aspects);
  const top = ranking.slice(0, TOP_N);
  const prices = stats.products.map((p) => p.price).filter((x): x is number => x != null);
  const summarize = (items: { aspect_name: string; share_of_products: number }[]) =>
    items.map((i) => `${i.aspect_name} (${pct(i.share_of_products)} of products)`);

  // J3: verdict for this store.
  const questions: Record<string, DecisionQuestion> = {
    fits: {
      type: "noul",
      instructions: `Should this store stock ${niche}?`,
      criteria: {
        true: "The niche matches the store's animals, price band and shoppers, and its reviews show products worth selling.",
        false: "The niche does not match the store, or its reviews show too many unresolved problems.",
      },
    },
    risk: { type: "score", instructions: `How risky is it for this store to stock ${niche}?`, criteria: RISK },
    deciding_aspect: {
      type: "choice",
      instructions: `Which aspect will decide whether ${niche} sell for this store?`,
      criteria: Object.fromEntries(aspects.map((a) => [a.key, a.name])),
    },
  };
  if (top.length > 1) {
    questions.start_with = {
      type: "choice",
      instructions: `Which of these ${niche} should this store stock first?`,
      criteria: Object.fromEntries(top.map((p) => [p.asin, `${shortTitle(p.title)}${p.price != null ? ` ($${p.price})` : ""}`])),
    };
  }
  const j3 = await call(
    {
      store: profile,
      niche: n.name,
      niche_price_range_usd: prices.length ? [Math.min(...prices), Math.max(...prices)] : null,
      aspect_importance_for_store: Object.fromEntries(aspects.map((a) => [a.name, IMPORTANCE[Math.round(weights[a.key] * 4)]])),
      reviews_show: {
        most_products_praised_for: summarize(four_box.table_stakes),
        few_products_praised_for: summarize(four_box.differentiators),
        most_products_complained_about: summarize(four_box.gaps),
        few_products_complained_about: summarize(four_box.red_flags),
      },
      top_products: top.map((p) => ({
        asin: p.asin, title: shortTitle(p.title), price: p.price, stars: p.average_rating, ratings: p.rating_number,
        score: p.score, reviews_with_praise: p.praise, reviews_with_complaints: p.complain, labeled_reviews: p.reviews,
      })),
    },
    questions,
  );

  const fits = j3.fits, risk = j3.risk, deciding = j3.deciding_aspect, start = j3.start_with;
  const topWeighted = aspects.reduce((a, b) => (weights[b.key] > weights[a.key] ? b : a)).key;
  return {
    id: n.id,
    name: n.name,
    fit_prob: fits?.type === "noul" ? Math.round(fits.noul * 100) / 100 : 0.5,
    risk: (risk?.type === "score" ? Math.min(4, Math.max(0, Math.round(risk.score))) : 2) as NicheResult["risk"],
    start_with: start?.type === "choice" && top.some((p) => p.asin === start.choice) ? start.choice : (top[0]?.asin ?? ""),
    deciding_aspect: deciding?.type === "choice" && weights[deciding.choice] != null ? deciding.choice : topWeighted,
    four_box,
    ranking,
  };
}

/** Everything the overview may use: numbers, verdicts and a couple of real review quotes per niche. */
async function overviewFacts(profile: Profile, niches: NicheResult[]) {
  const quote = async (niche: string, aspect: { key: string; name: string } | undefined, label: "praised" | "complained") => {
    if (!aspect) return null;
    const [e] = await getEvidence({ niche, aspect: aspect.key, label, limit: 1 });
    return e ? { label, aspect: aspect.name, stars: e.stars, text: e.text.length > QUOTE_CHARS ? `${e.text.slice(0, QUOTE_CHARS)}...` : e.text } : null;
  };
  return {
    how_to_read: {
      fit: "probability the niche fits this store (decision model)",
      risk: "0 = very low to 4 = very high",
      share_of_products: "share of the niche's best-selling products whose reviews show this",
      rate: "share of all labeled reviews in the niche that praise / complain about this",
      score: "product score within its niche, 0..1 (1 = best), from review praise minus complaints weighted by what this store's shoppers care about",
    },
    store: profile,
    niches: await Promise.all(
      niches.map(async (n) => {
        const start = n.ranking.find((p) => p.asin === n.start_with);
        const names = new Map(getAspects(n.id).map((a) => [a.key, a.name]));
        const name = (k: string) => names.get(k) ?? k;
        const worst = n.four_box.gaps[0] ?? n.four_box.red_flags[0];
        const box = (items: NicheResult["four_box"]["gaps"]) =>
          items.map((i) => ({ aspect: i.aspect_name, share_of_products: pct(i.share_of_products), rate: pct(i.rate) }));
        return {
          niche: n.name,
          fit: pct(n.fit_prob),
          risk: `${n.risk}/4`,
          deciding_aspect: name(n.deciding_aspect),
          start_with: start && {
            title: shortTitle(start.title), price: start.price, stars: start.average_rating, score: start.score,
            reviews_with_praise: start.praise, reviews_with_complaints: start.complain, labeled_reviews: start.reviews,
          },
          table_stakes: box(n.four_box.table_stakes),
          differentiators: box(n.four_box.differentiators),
          gaps: box(n.four_box.gaps),
          red_flags: box(n.four_box.red_flags),
          quotes: (await Promise.all([
            quote(n.id, { key: n.deciding_aspect, name: name(n.deciding_aspect) }, "praised"),
            quote(n.id, worst && { key: worst.aspect_key, name: worst.aspect_name }, "complained"),
          ])).filter(Boolean),
        };
      }),
    ),
  };
}
