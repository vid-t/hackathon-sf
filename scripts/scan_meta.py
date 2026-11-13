"""Phase 1: stream Pet_Supplies product details (~400 MB, never written to disk)
and store every popular product (>= 300 Amazon ratings) with its niche path.

Run: python3 scripts/scan_meta.py
"""
import gzip
import json
import pathlib
import sqlite3
import urllib.request

URL = "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/meta_categories/meta_Pet_Supplies.jsonl.gz"
DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "pets.db"
MIN_RATINGS = 300


def price(p):
    try:
        return float(p)
    except (TypeError, ValueError):
        return None


def main():
    DB.parent.mkdir(exist_ok=True)
    db = sqlite3.connect(DB)
    db.executescript("""
        DROP TABLE IF EXISTS catalog;
        CREATE TABLE catalog (
            parent_asin TEXT PRIMARY KEY,
            niche TEXT NOT NULL,          -- full category path, e.g. "Pet Supplies > Dogs > Beds & Furniture > Beds"
            title TEXT,
            store TEXT,                   -- brand
            price REAL,
            average_rating REAL,
            rating_number INTEGER,        -- total ratings on Amazon (popularity)
            image_url TEXT
        );
    """)
    rows, n = [], 0
    with urllib.request.urlopen(URL, timeout=60) as r:
        for line in gzip.GzipFile(fileobj=r):
            n += 1
            if n % 100_000 == 0:
                print(f"{n:,} products scanned, {len(rows):,} kept", flush=True)
            m = json.loads(line)
            cats = m.get("categories") or []
            if (m.get("rating_number") or 0) < MIN_RATINGS or not cats:
                continue
            images = m.get("images") or []
            img = (images[0].get("large") or images[0].get("hi_res")) if images else None
            rows.append((m["parent_asin"], " > ".join(cats), m.get("title"), m.get("store"),
                         price(m.get("price")), m.get("average_rating"), m.get("rating_number"), img))
    db.executemany("INSERT OR REPLACE INTO catalog VALUES (?,?,?,?,?,?,?,?)", rows)
    db.commit()
    print(f"\ndone: {n:,} products scanned, {len(rows):,} popular products stored in {DB}\n")

    print(f"{'products':>8} | {'brands':>6} | {'avg $':>5} | ratings | niche")
    for row in db.execute("""
        SELECT COUNT(*) n, COUNT(DISTINCT store), ROUND(AVG(price)),
               MIN(average_rating), MAX(average_rating), niche
        FROM catalog GROUP BY niche HAVING n >= 40 ORDER BY n DESC LIMIT 45
    """):
        n_, brands, avg_p, lo, hi, niche = row
        print(f"{n_:>8} | {brands:>6} | {avg_p!s:>5} | {lo}-{hi} | {niche}")


if __name__ == "__main__":
    main()
