// ============================================================================
// MOCK BACKEND. Stands in for Gemini (store profile, overview) and Drex
// (aspect weights, verdicts, review labels) until the real pipeline exists.
//
// Real: product titles, brands, prices, ratings and images (lib/catalog.ts).
// Mocked: everything else — fit_prob, risk, scores, praise/complain counts,
// four-box shares, store profile, overview text and evidence quotes.
// Output is deterministic per URL (seeded by a hash of the URL).
// ============================================================================
import { getCatalog, type CatalogProduct } from "./catalog";
import type {
  AnalyzeResponse,
  Evidence,
  FourBoxItem,
  NicheId,
  NicheResult,
  RankedProduct,
  StoreProfile,
} from "./types";

// --- deterministic randomness ------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// --- niches and aspects ------------------------------------------------------

type Level = "high" | "mid" | "low";
// [key, name, how often products are praised for it, how often they're complained about]
type AspectDef = [string, string, Level, Level];

type NicheDef = { id: NicheId; name: string; animal: "dog" | "cat"; aspects: AspectDef[] };

const NICHES: NicheDef[] = [
  { id: "dog-beds", name: "Dog beds", animal: "dog", aspects: [
    ["durability", "Durability", "low", "high"],
    ["washability", "Washability", "mid", "low"],
    ["support", "Support (flattening)", "low", "high"],
    ["sizing", "Sizing", "high", "low"],
    ["comfort", "Comfort", "high", "low"],
    ["odor", "Odor", "mid", "low"],
  ] },
  { id: "dog-harnesses", name: "Dog harnesses", animal: "dog", aspects: [
    ["fit", "Fit and sizing", "high", "high"],
    ["escape", "Escape-proofing", "low", "low"],
    ["chafing", "Chafing", "mid", "low"],
    ["pull-control", "Pull control", "high", "low"],
    ["buckles", "Buckle strength", "low", "low"],
    ["ease-on", "Ease of putting on", "high", "mid"],
  ] },
  { id: "dog-chew-toys", name: "Dog chew toys", animal: "dog", aspects: [
    ["durability", "Durability", "mid", "high"],
    ["safety", "Safety (pieces breaking off)", "low", "low"],
    ["interest", "Dog interest", "high", "low"],
    ["cleaning", "Easy to clean", "low", "low"],
    ["texture", "Texture and teeth", "high", "mid"],
  ] },
  { id: "dog-coats", name: "Dog coats", animal: "dog", aspects: [
    ["warmth", "Warmth", "high", "low"],
    ["sizing", "Sizing", "mid", "high"],
    ["waterproof", "Water resistance", "low", "low"],
    ["ease-on", "Ease of putting on", "low", "mid"],
    ["coverage", "Belly and leg coverage", "low", "high"],
    ["looks", "Looks", "high", "low"],
  ] },
  { id: "dog-car-seat-covers", name: "Car seat covers", animal: "dog", aspects: [
    ["waterproof", "Waterproofing", "high", "low"],
    ["stays-put", "Stays in place", "mid", "high"],
    ["scratch", "Scratch resistance", "low", "low"],
    ["fit", "Fit to seat", "high", "mid"],
    ["washability", "Washability", "low", "low"],
    ["belt-access", "Seat belt access", "low", "high"],
  ] },
  { id: "cat-fountains", name: "Cat water fountains", animal: "cat", aspects: [
    ["noise", "Pump noise", "low", "high"],
    ["filters", "Filter cost", "low", "high"],
    ["cleaning", "Ease of cleaning", "mid", "low"],
    ["pump", "Pump reliability", "high", "low"],
    ["acceptance", "Cat acceptance", "high", "low"],
    ["capacity", "Capacity", "high", "mid"],
  ] },
  { id: "cat-trees", name: "Cat trees", animal: "cat", aspects: [
    ["stability", "Stability", "mid", "high"],
    ["sisal", "Sisal durability", "low", "high"],
    ["assembly", "Assembly", "high", "low"],
    ["big-cats", "Room for large cats", "low", "low"],
    ["perches", "Perch comfort", "high", "low"],
  ] },
  { id: "cat-beds", name: "Cat beds", animal: "cat", aspects: [
    ["acceptance", "Cat acceptance", "high", "mid"],
    ["washability", "Washability", "low", "high"],
    ["warmth", "Warmth", "high", "low"],
    ["shape", "Holds its shape", "low", "high"],
    ["size", "Size", "mid", "low"],
  ] },
];

const NICHE_BY_ID = new Map(NICHES.map((n) => [n.id, n]));

const SHARE: Record<Level, [number, number]> = { high: [0.55, 0.86], mid: [0.32, 0.46], low: [0.08, 0.27] };

type AspectStats = {
  key: string;
  name: string;
  praiseShare: number;
  complainShare: number;
  praiseRate: number;
  complainRate: number;
};

// Four-box numbers come from review labels, so they depend on the niche, not on the store.
function aspectStats(n: NicheDef): AspectStats[] {
  const r = rng(`aspects:${n.id}`);
  return n.aspects.map(([key, name, p, c]) => ({
    key,
    name,
    praiseShare: round(between(r, ...SHARE[p]), 2),
    complainShare: round(between(r, ...SHARE[c]), 2),
    praiseRate: round(between(r, 0.04, 0.32), 2),
    complainRate: round(between(r, 0.02, 0.18), 2),
  }));
}

function fourBox(n: NicheDef, products: CatalogProduct[]): NicheResult["four_box"] {
  const r = rng(`fourbox:${n.id}`);
  const few = () => {
    const k = 1 + Math.floor(r() * Math.min(3, products.length));
    return [...products].sort(() => r() - 0.5).slice(0, k).map((p) => p.asin);
  };
  const box: NicheResult["four_box"] = { table_stakes: [], differentiators: [], gaps: [], red_flags: [] };
  for (const a of aspectStats(n)) {
    const praised: FourBoxItem = { aspect_key: a.key, aspect_name: a.name, share_of_products: a.praiseShare, rate: a.praiseRate };
    const complained: FourBoxItem = { aspect_key: a.key, aspect_name: a.name, share_of_products: a.complainShare, rate: a.complainRate };
    if (a.praiseShare >= 0.5) box.table_stakes.push(praised);
    else if (a.praiseShare <= 0.3) box.differentiators.push({ ...praised, product_asins: few() });
    if (a.complainShare >= 0.5) box.gaps.push(complained);
    else if (a.complainShare <= 0.3) box.red_flags.push({ ...complained, product_asins: few() });
  }
  for (const k of Object.keys(box) as (keyof typeof box)[]) box[k].sort((x, y) => y.share_of_products - x.share_of_products);
  return box;
}

// --- store profile (Gemini stand-in) -----------------------------------------

type Hint = { name: string; animals: ("dog" | "cat")[]; band: [number, number]; audience: string; feel: string; boost: Partial<Record<NicheId, number>> };

// The three example stores on the landing page, profiled by hand from their public /products.json.
const KNOWN: Record<string, Hint> = {
  "shopdogandco.com": {
    name: "Dog & Co.", animals: ["dog", "cat"], band: [14, 46],
    audience: "Style-minded dog owners shopping in store and online, plus gift buyers",
    feel: "Boutique and playful: knitwear, bandanas and squeaky toys from independent makers",
    boost: { "dog-coats": 1.2, "dog-harnesses": 0.8, "dog-chew-toys": 0.5, "cat-fountains": -1.0, "cat-trees": -1.2, "cat-beds": -0.6 },
  },
  "shop.hauspanther.com": {
    name: "Hauspanther", animals: ["cat"], band: [10, 140],
    audience: "Design-conscious cat owners who want furniture that suits their home",
    feel: "Curated and design-led: modern cat beds, scratchers and shelves",
    boost: { "cat-trees": 0.8, "cat-beds": 0.7, "cat-fountains": 0.1 },
  },
  "dogdogcat.com": {
    name: "Dog.Dog.Cat.", animals: ["dog", "cat"], band: [10, 30],
    audience: "Local dog and cat owners buying food, treats and everyday supplies",
    feel: "Neighborhood pet store: practical, well-stocked, friendly",
    boost: { "dog-chew-toys": 1.1, "dog-harnesses": 0.7, "cat-fountains": 0.4, "dog-beds": 0.3, "dog-coats": -0.4, "cat-trees": -0.5 },
  },
};

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./, "") || "your store";
  }
}

function profileStore(url: string): { profile: StoreProfile; boost: Partial<Record<NicheId, number>> } {
  const host = hostOf(url);
  const r = rng(`profile:${host}`);
  const known = KNOWN[host];
  if (known) {
    const kind = known.animals.length === 2 ? "dog and cat" : `${known.animals[0]}-focused`;
    return {
      boost: known.boost,
      profile: {
        url, name: known.name, animals: known.animals, price_band: known.band, audience: known.audience, feel: known.feel,
        summary: `${known.name} is a ${kind} shop with most products between $${known.band[0]} and $${known.band[1]}, selling to ${known.audience.charAt(0).toLowerCase()}${known.audience.slice(1)}.`,
      },
    };
  }

  const h = host.toLowerCase();
  const cat = /cat|kitt|meow|feline|purr|whisker/.test(h);
  const dog = /dog|pup|bark|canine|hound|woof|k9|paw/.test(h);
  const animals: ("dog" | "cat")[] = cat && !dog ? ["cat"] : dog && !cat ? ["dog"] : ["dog", "cat"];
  const base = host.split(".").slice(0, -1).join(" ").replace(/^shop\s+/, "") || host;
  const name = base.split(/[\s-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  const band = pick(r, [[8, 30], [12, 45], [20, 80], [30, 140]] as [number, number][]);
  const premium = band[1] >= 80;
  const audience = animals.length === 2
    ? pick(r, ["Local dog and cat owners shopping for everyday supplies", "Families with more than one pet, buying on repeat"])
    : animals[0] === "cat"
      ? pick(r, ["Indoor-cat owners who care about design", "Cat owners looking for problem-solving products"])
      : pick(r, ["Active dog owners who walk, hike and travel", "City dog owners buying gear and gifts"]);
  const feel = premium
    ? pick(r, ["Curated and premium", "Design-led boutique"])
    : pick(r, ["Practical and good value", "Friendly neighborhood shop"]);
  const kind = animals.length === 2 ? "general pet" : `${animals[0]}-focused`;
  const boost: Partial<Record<NicheId, number>> = {};
  if (/coat|wear|apparel|style/.test(h)) boost["dog-coats"] = 0.7;
  if (/toy|play|chew/.test(h)) boost["dog-chew-toys"] = 0.7;
  if (/walk|leash|harness|hike|adventure/.test(h)) boost["dog-harnesses"] = 0.7;
  if (/bed|sleep|home|nest/.test(h)) { boost["dog-beds"] = 0.5; boost["cat-beds"] = 0.5; }
  if (/car|travel|road/.test(h)) boost["dog-car-seat-covers"] = 0.8;

  return {
    boost,
    profile: {
      url, name, animals, price_band: band, audience, feel,
      summary: `${name} reads as a ${kind} store with most products between $${band[0]} and $${band[1]}. ${feel}, aimed at ${audience.charAt(0).toLowerCase()}${audience.slice(1)}.`,
    },
  };
}

// --- Drex stand-in: per-niche verdict and product ranking -----------------------

function rankProducts(url: string, n: NicheDef, products: CatalogProduct[]): RankedProduct[] {
  return products
    .map((p) => {
      const fixed = rng(`product:${p.asin}`); // review labels: store-independent
      const reviews = Math.min(200, p.rating_number ?? 120);
      const quality = clamp(((p.average_rating ?? 4.2) - 3.6) / 1.2, 0, 1);
      const praiseShare = clamp(0.3 + quality * 0.35 + between(fixed, -0.08, 0.08), 0.15, 0.85);
      const complainShare = clamp(0.24 - quality * 0.14 + between(fixed, -0.05, 0.06), 0.03, 0.4);
      const fit = rng(`score:${url}:${p.asin}`); // Drex's weighting: store-dependent
      const score = clamp(0.35 * praiseShare + 0.45 * quality + between(fit, 0, 0.28) - complainShare * 0.3 + 0.12, 0.05, 0.98);
      return {
        ...p,
        score: round(score, 2),
        praise: Math.round(reviews * praiseShare),
        complain: Math.round(reviews * complainShare),
        reviews,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function verdict(url: string, store: StoreProfile, boost: Partial<Record<NicheId, number>>, n: NicheDef, products: CatalogProduct[]): NicheResult {
  const r = rng(`niche:${url}:${n.id}`);
  const four_box = fourBox(n, products);
  const ranking = rankProducts(url, n, products);

  const animalMatch = store.animals.includes(n.animal) ? (store.animals.length === 1 ? 1.5 : 0.9) : -1.6;
  const prices = products.map((p) => p.price).filter((x): x is number => x != null).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 30;
  const [lo, hi] = store.price_band;
  const priceFit = median >= lo * 0.8 && median <= hi * 1.15 ? 0.5 : -0.4;
  const logit = -1.1 + animalMatch + priceFit + (boost[n.id] ?? 0) + between(r, -0.6, 0.6);
  const fit_prob = round(clamp(1 / (1 + Math.exp(-logit)), 0.03, 0.97), 2);

  const risk = clamp(Math.round((1 - fit_prob) * 2.2 + four_box.gaps.length * 0.35 + between(r, -0.4, 0.6)), 0, 4) as NicheResult["risk"];

  // How much each aspect matters to this store; the top one decides.
  const weights = n.aspects.map(([key]) => ({ key, w: r() }));
  const deciding_aspect = weights.sort((a, b) => b.w - a.w)[0].key;

  return { id: n.id, name: n.name, fit_prob, risk, start_with: ranking[0]?.asin ?? "", deciding_aspect, four_box, ranking };
}

// --- Gemini stand-in: overview from the numbers only -----------------------------

const pct = (x: number) => `${Math.round(x * 100)}%`;

function overview(store: StoreProfile, niches: NicheResult[]): string {
  const fits = niches.filter((n) => n.fit_prob >= 0.6);
  const maybe = niches.filter((n) => n.fit_prob >= 0.35 && n.fit_prob < 0.6);
  const skip = niches.filter((n) => n.fit_prob < 0.35);
  const aspectName = (n: NicheResult, key: string) =>
    Object.values(n.four_box).flat().find((a) => a.aspect_key === key)?.aspect_name.toLowerCase() ?? key;
  const title = (n: NicheResult) => {
    const full = n.ranking.find((p) => p.asin === n.start_with)?.title;
    if (!full) return "the top-ranked product";
    const dash = full.split(" - ")[0].trim();
    const t = dash.length >= 12 ? dash : full.split(",")[0].trim();
    return t.length <= 60 ? t : t.slice(0, 60).replace(/\s+\S*$/, "");
  };

  const lines: string[] = [];
  lines.push(`## What fits ${store.name}`);
  if (fits.length) {
    lines.push(
      `${fits.length === 1 ? "One niche clears" : `${fits.length} niches clear`} a 60% fit: ${fits.map((n) => `**${n.name.toLowerCase()}** (${pct(n.fit_prob)})`).join(", ")}. Start with the products below and expand once they sell through.`,
    );
    lines.push("");
    for (const n of fits.slice(0, 3)) {
      const gap = n.four_box.gaps[0];
      lines.push(
        `- **${n.name}:** start with ${title(n)}. Drex weighted *${aspectName(n, n.deciding_aspect)}* most for your store.${gap ? ` Watch ${gap.aspect_name.toLowerCase()}: shoppers complain about it for ${pct(gap.share_of_products)} of products in this niche.` : ""}`,
      );
    }
  } else {
    lines.push(`None of the eight niches clears a 60% fit. The closest is **${niches[0].name.toLowerCase()}** at ${pct(niches[0].fit_prob)}; test it with a small order first.`);
  }
  if (maybe.length) {
    lines.push("", "## Worth a small test");
    lines.push(`${maybe.map((n) => `${n.name} (${pct(n.fit_prob)}, risk ${n.risk} of 4)`).join("; ")}. These fit some of your shoppers, but the reviews show enough complaints that a short run is safer than a full range.`);
  }
  if (skip.length) {
    lines.push("", "## Skip for now");
    lines.push(`${skip.map((n) => n.name).join(", ")} fit your store poorly (under 35%). The reviews give no strong reason to stock them yet.`);
  }
  return lines.join("\n");
}

// --- public API used by the route handlers ------------------------------------

export async function mockAnalyze(url: string): Promise<AnalyzeResponse> {
  const t0 = Date.now();
  await sleep(1500); // MOCK: make loading states visible

  const catalog = getCatalog();
  const { profile, boost } = profileStore(url);
  const niches = NICHES.map((n) => verdict(url, profile, boost, n, catalog.get(n.id) ?? [])).sort((a, b) => b.fit_prob - a.fit_prob);

  const top = niches.filter((n) => n.fit_prob >= 0.5).slice(0, 4);
  const sources = top.length >= 3 ? top : niches.slice(0, 3);
  const best_products = sources.flatMap((n) => (n.ranking[0] ? [{ ...n.ranking[0], niche_id: n.id }] : []));

  const jev_calls = NICHES.reduce((s, n) => s + n.aspects.length + 1, 0); // one weight per aspect + one verdict per niche
  return {
    store: profile,
    niches,
    best_products,
    overview_md: overview(profile, niches),
    stats: { jev_calls, ms: Date.now() - t0, cost_usd: round(jev_calls * 0.0004 + 0.0035, 4) },
  };
}

const PRAISED = [
  "Really happy with the {a}. No issues so far.",
  "The {a} is the reason we bought a second one.",
  "{A} held up well after a few months of daily use.",
  "Better {a} than the last one we tried.",
  "We were worried about {a}, but it turned out great.",
];
const COMPLAINED = [
  "Disappointed by the {a}. Expected better at this price.",
  "{A} was the problem. It didn't last.",
  "Would be five stars if not for the {a}.",
  "The {a} is not as described.",
  "Returned it because of the {a}.",
];

export function mockEvidence(nicheId: string, aspectKey: string, label: "praised" | "complained", asin?: string): Evidence[] | null {
  const n = NICHE_BY_ID.get(nicheId as NicheId);
  if (!n) return null;
  const aspect = n.aspects.find(([k]) => k === aspectKey);
  if (!aspect) return null;
  const products = getCatalog().get(n.id) ?? [];
  const r = rng(`evidence:${nicheId}:${aspectKey}:${label}:${asin ?? ""}`);
  const name = aspect[1].toLowerCase();
  const templates = label === "praised" ? PRAISED : COMPLAINED;
  const count = 3 + Math.floor(r() * (templates.length - 2)); // 3..5, no repeated text
  const offset = Math.floor(r() * templates.length);

  return Array.from({ length: count }, (_, i) => {
    const t = templates[(offset + i) % templates.length];
    const day = new Date(Date.UTC(2019, 0, 1) + Math.floor(r() * 1700) * 86400000);
    return {
      review_id: 100000 + Math.floor(r() * 900000),
      asin: asin ?? products[Math.floor(r() * products.length)]?.asin ?? "",
      stars: label === "praised" ? (r() < 0.75 ? 5 : 4) : 1 + Math.floor(r() * 3),
      title: "Mock review",
      text: t.replace("{a}", name).replace("{A}", name[0].toUpperCase() + name.slice(1)),
      date: day.toISOString().slice(0, 10),
      label,
      confidence: round(between(r, 0.71, 0.98), 2),
    };
  }).sort((a, b) => b.confidence - a.confidence);
}
