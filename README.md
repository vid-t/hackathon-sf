# ShelfScout

**Which pet products should *your* store stock?** Paste an online pet store's link. ShelfScout reads the store, then ranks eight pet-supply niches for it using 40,000 real Amazon reviews, each labelled by a System One decision model. Every number links back to the reviews behind it.

Amazon gives sellers niche-level review insights, but only for selling on Amazon. ShelfScout gives independent stores (Shopify and others) a fit verdict for *their* store, built on counted evidence instead of a chatbot's opinion.

## How it works

```
Offline (once)
  Amazon Reviews 2023, Pet Supplies ─► 8 niches · 205 products · 39,996 newest reviews (SQLite)
  6–7 aspects per niche (e.g. dog beds: support, durability, washability, waterproofing…)
  Drex labels every review × aspect: praised / complained / not mentioned (+ confidence)

Live (per store, ~11 s, ~$0.001)
  store link ─► Gemini profiles the store (animals, price band, audience, feel)
             ─► for each niche, Drex weighs each aspect for this store, then gives a verdict:
                fits? (probability) · which product to start with · risk 0–4 · deciding aspect
             ─► SQL builds the four-box: table stakes · differentiators · category gaps · red flags
             ─► Gemini writes an honest overview from those numbers and real review quotes only
```

- **Drex Max** (`nace-ai/drex-max`) via OpenRouter's Decisions API: a System One model that returns typed answers with calibrated probabilities, not text. Labels below 0.6 confidence are marked *unsure* and left out of the counts.
- **Gemini** (`google/gemini-3.5-flash-lite`) via OpenRouter: store profile (structured JSON) and the final overview.
- **Data:** [Amazon Reviews 2023](https://amazon-reviews-2023.github.io/) (McAuley Lab, UCSD), Pet_Supplies category, streamed and filtered without storing the raw files.

35,877 of the 39,996 reviews are labelled (every product covered); the run stopped at a $2 API-key cap, at ~30 reviews/s. `python3 scripts/label.py` resumes the rest.

## Run it

```bash
# repo-root .env
OPENROUTER_API_KEY=sk-or-v1-...
```

```bash
cd web && npm install && npm run dev   # http://localhost:3000
```

`data/pets.db` ships with the reviews and labels. To rebuild it: `python3 scripts/scan_meta.py`, `python3 scripts/ingest_reviews.py`, `python3 scripts/aspects.py`, `python3 scripts/label.py` (standard-library Python 3).

## Layout

- `scripts/`: offline data pipeline (ingest, aspects, Drex labelling)
- `data/pets.db`: SQLite: catalog, niches, products, reviews, aspects, review_labels
- `web/`: Next.js app; `web/lib/server/` is the live pipeline (`analyze.ts`, `decisions.ts`, `gemini.ts`, `analysis.ts`, `store.ts`)
- `docs/brightdata-petco.md`: next step, fresh Petco reviews via Bright Data for a live "2023 vs today" comparison
