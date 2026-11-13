// API contract shared by the UI and the backend (mock today, real later).
// Keep these shapes stable: the UI depends on them, not on lib/mock.ts.
//
// Units as the UI reads them:
// - fit_prob, score, share_of_products, rate, confidence: 0..1
// - praise / complain: number of reviews (out of `reviews`) labeled praised / complained
// - deciding_aspect: an aspect_key (the UI looks up its display name in four_box)

export type NicheId = "dog-beds" | "dog-harnesses" | "dog-chew-toys" | "dog-coats" | "dog-car-seat-covers" | "cat-fountains" | "cat-trees" | "cat-beds";
export type StoreProfile = { url: string; name: string; animals: ("dog" | "cat")[]; price_band: [number, number]; audience: string; feel: string; summary: string };
export type FourBoxItem = { aspect_key: string; aspect_name: string; share_of_products: number; rate: number; product_asins?: string[] };
export type RankedProduct = { asin: string; title: string; brand: string | null; price: number | null; average_rating: number | null; rating_number: number | null; image_url: string | null; score: number; praise: number; complain: number; reviews: number };
export type NicheResult = { id: NicheId; name: string; fit_prob: number; risk: 0 | 1 | 2 | 3 | 4; start_with: string /* asin */; deciding_aspect: string; four_box: { table_stakes: FourBoxItem[]; differentiators: FourBoxItem[]; gaps: FourBoxItem[]; red_flags: FourBoxItem[] }; ranking: RankedProduct[] };
export type AnalyzeResponse = { store: StoreProfile; niches: NicheResult[] /* sorted by fit_prob desc */; best_products: (RankedProduct & { niche_id: NicheId })[]; overview_md: string; stats: { jev_calls: number; ms: number; cost_usd: number } };
export type Evidence = { review_id: number; asin: string; stars: number; title: string | null; text: string; date: string; label: "praised" | "complained"; confidence: number };
