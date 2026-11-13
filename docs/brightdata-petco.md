# Bright Data — Petco scrape (parked for later)

Status: not run yet. Use it later if Petco data matches our 8 niches.

## The request

Starts an async scrape for a list of Petco product URLs. Key comes from the environment — never paste it here.

```bash
curl -H "Authorization: Bearer $BRIGHTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":[{"url":"https://www.petco.com/shop/en/petcostore/product/freshpet-vital-balanced-nutrition-chicken-recipe-with-peas"},{"url":"https://www.petco.com/shop/en/petcostore/product/blue-buffalo-bones-natural-crunchy-beef-chicken-and-bacon-small-dog-biscuits-assorted"}],"limit_per_input":null}' \
  "https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_ml3ibraw23zw575aqf&notify=false&include_errors=true"
```

- Scraper ID: `gd_ml3ibraw23zw575aqf` (not in Bright Data's public docs — check its name in the dashboard: Petco **products** or Petco **reviews** scraper; we want reviews for Jev).
- Returns a `snapshot_id`, not data. Then:
  - Progress: `GET https://api.brightdata.com/datasets/v3/progress/{snapshot_id}`
  - Download: `GET https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}?format=json`
- Billed per successful record.

## Before using it

1. **Swap the URLs.** The two above are food/treats, which are outside our menu. Use Petco product URLs from our niches: dog beds, dog vest harnesses, dog chew toys, dog winter coats, dog car seat covers, cat water fountains, cat trees, cat beds.
2. **Match by niche, not product.** Petco item IDs aren't Amazon ASINs, so Petco rows go into `pets.db` under the same `niche_id` with `source = 'petco'`.

## What it's for

- **Fresh reviews:** our Amazon data ends Sep 2023; Petco reviews are current. Jev labels them with the same aspect questions.
- **"2023 vs today" per niche:** e.g. dog-bed flattening complaints on Amazon 2023 vs Petco now — shows whether a gap still exists.
- **Live demo moment (J4):** fetch a few hundred fresh Petco reviews and label them with Jev on stage.
- **Competition signal:** what a big pet retailer already stocks in each niche.

## Related Bright Data scrapers (from the docs)

- Petco reviews, PetSmart reviews, Chewy reviews scrapers exist (brightdata.com/products/web-scraper/…).
- Amazon: products `gd_l7q7dkf244hwjntr0` (also discover by keyword), reviews `gd_le8e811kzy4ggddlq`. Sync `/scrape` waits up to 1 min, else returns a `snapshot_id`; use `/trigger` for batches.
