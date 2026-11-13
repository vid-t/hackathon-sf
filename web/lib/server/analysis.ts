// Turns review labels (review_labels, written offline by scripts/label.py) into per-niche
// four-boxes, product rankings and evidence quotes. Pure SQL + arithmetic, no model calls.
import type { Evidence, FourBoxItem, NicheId, NicheResult, RankedProduct } from "../types";
import { db } from "./db";

export const PRAISE_MIN = 0.25; // a product "has praise" for an aspect when >= 25% of its labeled reviews praise it
export const COMPLAIN_MIN = 0.1; // a product "has a complaint" when >= 10% complain about it
export const COMMON_SHARE = 0.6; // >= 60% of products -> table stakes (praise) / gaps (complaints)
export const RARE_SHARE = 0.25; // <= 25% (and > 0) of products -> differentiators / red flags
export const MIN_LABELED_REVIEWS = 10; // products with fewer labeled reviews are left out
export const EVIDENCE_LIMIT = 6;

export type Niche = { id: NicheId; name: string };
export type Aspect = { key: string; name: string; praised_desc: string; complained_desc: string };
type AspectStat = { praised: number; complained: number; n: number }; // n = labels other than 'unsure'
type ProductStats = Omit<RankedProduct, "score"> & { aspects: Map<string, AspectStat> };
export type NicheStats = { products: ProductStats[] };

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export function listNiches(): Niche[] {
  const ready = db().prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('aspects', 'review_labels')").get() as { n: number };
  if (ready.n < 2) throw new Error("No review labels yet: run scripts/aspects.py, then scripts/label.py");
  return db().prepare("SELECT id, name FROM niches ORDER BY id").all() as Niche[];
}

export function getAspects(nicheId: string): Aspect[] {
  return db()
    .prepare("SELECT key, name, praised_desc, complained_desc FROM aspects WHERE niche_id = ? ORDER BY rowid")
    .all(nicheId) as Aspect[];
}

/** Per-product review counts and per-aspect praise / complaint counts for one niche. */
export function nicheStats(nicheId: string): NicheStats {
  const products = db()
    .prepare(
      `SELECT p.parent_asin AS asin, p.title, p.store AS brand, p.price, p.average_rating, p.rating_number, p.image_url,
              COUNT(*) AS reviews, SUM(x.praised > 0) AS praise, SUM(x.complained > 0) AS complain
       FROM products p JOIN (
         SELECT r.parent_asin, SUM(l.label = 'praised') AS praised, SUM(l.label = 'complained') AS complained
         FROM products p2 JOIN reviews r ON r.parent_asin = p2.parent_asin JOIN review_labels l ON l.review_id = r.id
         WHERE p2.niche_id = ? GROUP BY r.id
       ) x ON x.parent_asin = p.parent_asin
       GROUP BY p.parent_asin HAVING COUNT(*) >= ?
       ORDER BY p.rating_number DESC`,
    )
    .all(nicheId, MIN_LABELED_REVIEWS) as Omit<ProductStats, "aspects">[];

  const byAsin = new Map<string, ProductStats>(products.map((p) => [p.asin, { ...p, aspects: new Map() }]));
  const rows = db()
    .prepare(
      `SELECT r.parent_asin AS asin, l.aspect_key AS key,
              SUM(l.label = 'praised') AS praised, SUM(l.label = 'complained') AS complained, COUNT(*) AS n
       FROM products p JOIN reviews r ON r.parent_asin = p.parent_asin JOIN review_labels l ON l.review_id = r.id
       WHERE p.niche_id = ? AND l.label != 'unsure'
       GROUP BY r.parent_asin, l.aspect_key`,
    )
    .all(nicheId) as ({ asin: string; key: string } & AspectStat)[];
  for (const { asin, key, praised, complained, n } of rows) byAsin.get(asin)?.aspects.set(key, { praised, complained, n });
  return { products: [...byAsin.values()] };
}

/** Which aspects most products get praised / complained about (table stakes / gaps) and which only a few (differentiators / red flags). */
export function fourBox(stats: NicheStats, aspects: Aspect[]): NicheResult["four_box"] {
  const box: NicheResult["four_box"] = { table_stakes: [], differentiators: [], gaps: [], red_flags: [] };
  const total = stats.products.length;
  if (!total) return box;
  for (const a of aspects) {
    let praised = 0, complained = 0, n = 0;
    const withPraise: string[] = [];
    const withComplaint: string[] = [];
    for (const p of stats.products) {
      const s = p.aspects.get(a.key);
      if (!s?.n) continue;
      praised += s.praised;
      complained += s.complained;
      n += s.n;
      if (s.praised / s.n >= PRAISE_MIN) withPraise.push(p.asin);
      if (s.complained / s.n >= COMPLAIN_MIN) withComplaint.push(p.asin);
    }
    const base = { aspect_key: a.key, aspect_name: a.name };
    const praise: FourBoxItem = { ...base, share_of_products: round(withPraise.length / total), rate: round(n ? praised / n : 0) };
    const complaint: FourBoxItem = { ...base, share_of_products: round(withComplaint.length / total), rate: round(n ? complained / n : 0) };
    if (praise.share_of_products >= COMMON_SHARE) box.table_stakes.push(praise);
    else if (praise.share_of_products > 0 && praise.share_of_products <= RARE_SHARE) box.differentiators.push({ ...praise, product_asins: withPraise });
    if (complaint.share_of_products >= COMMON_SHARE) box.gaps.push(complaint);
    else if (complaint.share_of_products > 0 && complaint.share_of_products <= RARE_SHARE) box.red_flags.push({ ...complaint, product_asins: withComplaint });
  }
  for (const items of Object.values(box)) items.sort((x, y) => y.share_of_products - x.share_of_products);
  return box;
}

/**
 * score = sum over aspects of weight x (praise rate - complaint rate), min-max normalised to 0..1
 * within the niche (best product = 1). Weights come from the decision model (0..1 per aspect).
 */
export function rankProducts(stats: NicheStats, weights: Record<string, number>): RankedProduct[] {
  const keys = Object.keys(weights);
  const wsum = keys.reduce((s, k) => s + weights[k], 0);
  const w = (k: string) => (wsum > 0 ? weights[k] : 1);
  const net = stats.products.map((p) =>
    keys.reduce((s, k) => {
      const a = p.aspects.get(k);
      return a?.n ? s + w(k) * ((a.praised - a.complained) / a.n) : s;
    }, 0),
  );
  const lo = Math.min(...net), hi = Math.max(...net);
  return stats.products
    .map(({ aspects: _aspects, ...p }, i) => ({ ...p, score: round(hi > lo ? (net[i] - lo) / (hi - lo) : 0.5, 2) }))
    .sort((a, b) => b.score - a.score || (b.rating_number ?? 0) - (a.rating_number ?? 0));
}

const cleanText = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").trim();

/** Reviews with that label for one aspect, most confident first (helpful votes break ties). */
export async function getEvidence(p: {
  niche: string;
  aspect: string;
  label: "praised" | "complained";
  asin?: string;
  limit?: number;
}): Promise<Evidence[]> {
  const rows = db()
    .prepare(
      `SELECT r.id AS review_id, r.parent_asin AS asin, r.rating AS stars, r.title, r.text, r.ts, l.label, l.confidence
       FROM products p JOIN reviews r ON r.parent_asin = p.parent_asin
       JOIN review_labels l ON l.review_id = r.id AND l.aspect_key = ?
       WHERE p.niche_id = ? AND l.label = ? ${p.asin ? "AND p.parent_asin = ?" : ""}
       ORDER BY l.confidence DESC, r.helpful_votes DESC
       LIMIT ?`,
    )
    .all(p.aspect, p.niche, p.label, ...(p.asin ? [p.asin] : []), p.limit ?? EVIDENCE_LIMIT) as {
    review_id: number; asin: string; stars: number; title: string | null; text: string; ts: number;
    label: "praised" | "complained"; confidence: number;
  }[];
  return rows.map(({ ts, ...r }) => ({
    ...r,
    title: r.title ? cleanText(r.title) : null,
    text: cleanText(r.text),
    date: new Date(ts).toISOString().slice(0, 10),
    confidence: round(r.confidence, 2),
  }));
}
