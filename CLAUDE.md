# CLAUDE.md

Hackathon project — optimize for a working demo fast.

Store-fit category ranker: paste a store link → Gemini profiles the store → Drex Max (`nace-ai/drex-max`, a System One decision model, via OpenRouter's Decisions API) labels Amazon reviews and decides which pet-supply niche fits the store → Gemini writes an honest overview. Gemini (`google/gemini-3.5-flash-lite`) is also called through OpenRouter, so one key does both. Keys live in the repo-root `.env` (`OPENROUTER_API_KEY`, later `BRIGHTDATA_API_KEY`); the scripts and `web/next.config.ts` load it at runtime. Data: Amazon Reviews 2023 (McAuley Lab), Pet_Supplies category. Planned app: Next.js (not scaffolded yet).

## Commands

Data pipeline (Python 3 stdlib only; streams from the dataset host, writes only `data/pets.db`):

- `python3 scripts/scan_meta.py` — stream all Pet_Supplies product details (~400 MB), store popular products (≥300 ratings) in `catalog`, print niche summary.
- `python3 scripts/ingest_reviews.py` — stream the full reviews file (~2.3 GB) and build `niches` / `products` / `reviews` for the menu in `MENU`: the newest ≤200 reviews per product, filling 5,000 reviews per niche from the most popular products down (~40K total). Rebuilds those three tables; `catalog` is kept.
- `python3 scripts/aspects.py` — write the hand-written aspect list per niche (in the script) into `aspects`. These are Drex's labelling questions; refuses to replace aspects of a niche that already has labels unless `--force`.
- `python3 scripts/label.py [--limit N] [--niche ID] [--dry-run] [--show N]` — Drex labels each review per aspect (praised / complained / not mentioned) into `review_labels`. Resumable; needs `OPENROUTER_API_KEY` in the root `.env`.

App (Next.js 16 in `web/`; Gemini is used only here, for the live store profile and overview):

- `cd web && npm run dev` — http://localhost:3000. `/api/analyze` and `/api/evidence` use the real pipeline (`web/lib/server/`) and fall back to labelled sample data (`web/lib/mock.ts`) when keys or labels are missing.
- `cd web && npx tsc --noEmit` — type-check.

## Notes

- The project folder path ends in a trailing space (`Hacakthon SF `) — always quote paths.
- Claude cannot `git push` (denied in user settings); the user pushes.
- Never commit secrets: keep them in `.env*` (gitignored) and document required keys in `.env.example`.
