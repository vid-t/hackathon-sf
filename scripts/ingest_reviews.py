"""Phase 2: pick candidate products per menu niche from `catalog`, stream the FULL
Pet_Supplies reviews file (~2.3 GB, never written to disk) and keep the most
recent reviews for them: up to PER_PRODUCT per product, filling NICHE_BUDGET per
niche in popularity order (8 niches x 5,000 = ~40K reviews).

Run: python3 scripts/ingest_reviews.py   (after scripts/scan_meta.py)
"""
import gzip
import heapq
import json
import pathlib
import re
import sqlite3
import urllib.request
from collections import defaultdict

URL = "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/review_categories/Pet_Supplies.jsonl.gz"
DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "pets.db"
CANDIDATES = 40       # most popular products per niche considered
PER_PRODUCT = 200     # most recent reviews kept per product
NICHE_BUDGET = 5_000  # reviews per niche
MIN_TEXT = 20         # drop empty / one-word reviews
MIN_REVIEWS = 20      # skip products too thin to judge (reviews filed elsewhere)

# slug -> (display name, full category path from scan_meta output).
# Durable goods only (no food/treats/supplements), wide rating spread,
# a dog + cat mix so different store types rank them differently.
MENU = {
    "dog-beds": ("Dog beds", "Pet Supplies > Dogs > Beds & Furniture > Beds"),
    "dog-harnesses": ("Dog vest harnesses", "Pet Supplies > Dogs > Collars, Harnesses & Leashes > Harnesses > Vest Harnesses"),
    "dog-chew-toys": ("Dog chew toys", "Pet Supplies > Dogs > Toys > Chew Toys"),
    "dog-coats": ("Dog winter coats", "Pet Supplies > Dogs > Apparel & Accessories > Cold Weather Coats"),
    "dog-car-seat-covers": ("Dog car seat covers", "Pet Supplies > Dogs > Carriers & Travel Products > Car Travel Accessories > Seat Covers"),
    "cat-fountains": ("Cat water fountains", "Pet Supplies > Cats > Feeding & Watering Supplies > Fountains"),
    "cat-trees": ("Cat trees", "Pet Supplies > Cats > Beds & Furniture > Trees"),
    "cat-beds": ("Cat beds", "Pet Supplies > Cats > Beds & Furniture > Beds"),
}

ASIN_RE = re.compile(rb'"parent_asin": "([^"]+)"')
INSERT_REVIEW = """INSERT INTO reviews (parent_asin, rating, title, text, ts, verified, helpful_votes)
                   VALUES (?,?,?,?,?,?,?)"""


def main():
    db = sqlite3.connect(DB)
    db.executescript("""
        DROP TABLE IF EXISTS niches;
        DROP TABLE IF EXISTS products;
        DROP TABLE IF EXISTS reviews;
        CREATE TABLE niches (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL);
        CREATE TABLE products (
            parent_asin TEXT PRIMARY KEY,
            niche_id TEXT NOT NULL REFERENCES niches(id),
            title TEXT, store TEXT, price REAL, average_rating REAL,
            rating_number INTEGER, image_url TEXT,
            source TEXT NOT NULL DEFAULT 'hf2023'
        );
        CREATE TABLE reviews (
            id INTEGER PRIMARY KEY,
            parent_asin TEXT NOT NULL REFERENCES products(parent_asin),
            rating INTEGER, title TEXT, text TEXT, ts INTEGER,
            verified INTEGER, helpful_votes INTEGER,
            source TEXT NOT NULL DEFAULT 'hf2023'
        );
        CREATE INDEX reviews_by_product ON reviews(parent_asin);
    """)
    for slug, (name, path) in MENU.items():
        db.execute("INSERT INTO niches VALUES (?,?,?)", (slug, name, path))
        seen_titles, picked = set(), 0
        for row in db.execute("""
            SELECT parent_asin, title, store, price, average_rating, rating_number, image_url
            FROM catalog WHERE niche = ? ORDER BY rating_number DESC
        """, (path,)).fetchall():
            key = (row[1] or "").lower()[:60]  # duplicate listings share a title
            if key in seen_titles:
                continue
            seen_titles.add(key)
            db.execute("""INSERT INTO products (parent_asin, niche_id, title, store, price, average_rating, rating_number, image_url)
                          VALUES (?,?,?,?,?,?,?,?)""", (row[0], slug, *row[1:]))
            picked += 1
            if picked == CANDIDATES:
                break
    wanted = {a for (a,) in db.execute("SELECT parent_asin FROM products")}
    print(f"{len(wanted)} candidate products across {len(MENU)} niches; streaming full reviews file...", flush=True)

    # parent_asin -> min-heap of (ts, line_no, row) holding that product's newest PER_PRODUCT reviews
    latest = defaultdict(list)
    matched = 0
    with urllib.request.urlopen(URL, timeout=60) as r:
        for i, line in enumerate(gzip.GzipFile(fileobj=r)):
            if i % 1_000_000 == 0 and i:
                print(f"{i:,} reviews scanned, {matched:,} matched", flush=True)
            m = ASIN_RE.search(line)
            if not m or m.group(1).decode() not in wanted:
                continue
            rv = json.loads(line)
            text = (rv.get("text") or "").strip()
            if len(text) < MIN_TEXT:
                continue
            matched += 1
            row = (rv["parent_asin"], int(rv["rating"]), rv.get("title"), text,
                   rv["timestamp"], int(bool(rv.get("verified_purchase"))), rv.get("helpful_vote") or 0)
            h = latest[rv["parent_asin"]]
            if len(h) < PER_PRODUCT:
                heapq.heappush(h, (row[4], i, row))
            elif row[4] > h[0][0]:
                heapq.heapreplace(h, (row[4], i, row))
    print(f"stream done: {i + 1:,} reviews scanned, {matched:,} matched", flush=True)

    # Fill each niche's budget with the newest reviews, most popular products first.
    for slug in MENU:
        budget = NICHE_BUDGET
        for (asin,) in db.execute("SELECT parent_asin FROM products WHERE niche_id = ? ORDER BY rating_number DESC",
                                  (slug,)).fetchall():
            rows = [x[2] for x in sorted(latest.get(asin, []), reverse=True)][:budget]
            if len(rows) < MIN_REVIEWS:
                continue
            db.executemany(INSERT_REVIEW, rows)
            budget -= len(rows)
            if budget < MIN_REVIEWS:
                break
    db.execute("DELETE FROM products WHERE parent_asin NOT IN (SELECT DISTINCT parent_asin FROM reviews)")
    db.commit()
    print("done.", flush=True)


if __name__ == "__main__":
    main()
