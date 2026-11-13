"""J1: label every review against its niche's aspects with an OpenRouter decision model -
one Decisions call per review, one `choice` question per aspect (praised / complained /
not_mentioned). Writes `review_labels` (label = 'unsure' when confidence < 0.6) and logs to `runs`.

Resumable (skips labeled reviews). Order: the first REVIEW_TIER reviews of every
product (most popular products first), then the next tier, ... so a partial run
already covers every niche and product.

Run: python3 scripts/label.py [--limit N] [--niche ID] [--dry-run] [--concurrency 20]
Needs OPENROUTER_API_KEY (environment or root .env). Optional DECISION_MODEL
(default nace-ai/drex-max) and DECISIONS_URL (default OpenRouter's /api/alpha/decisions).
"""
import argparse
import json
import os
import pathlib
import random
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "pets.db"
REVIEW_CHARS = 1_500
MIN_CONFIDENCE = 0.6
REVIEW_TIER = 25         # reviews per product per ordering tier
MAX_ATTEMPTS = 6
TIMEOUT_S = 60


def load_env():
    """Fill os.environ from the root .env without overriding what is set. Values are never printed."""
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.removeprefix("export ").strip(), v.strip().strip("\"'"))


def build_body(model, aspects, niche_name, product, stars, title, text):
    text = re.sub(r"<br\s*/?>", "\n", text)
    review = (f"{title}\n\n{text}" if title else text)[:REVIEW_CHARS]
    return {
        "model": model,
        "state": {"niche": niche_name, "product": product, "stars": stars, "review": review},
        "questions": {
            key: {
                "type": "choice",
                "instructions": f"{name}: does this review praise it, complain about it, or not mention it?",
                "criteria": {"praised": praised, "complained": complained,
                             "not_mentioned": "Not discussed in this review."},
            }
            for key, name, praised, complained in aspects
        },
    }


class Fatal(Exception):
    pass


# All workers pause together when any of them is told to slow down.
_pause_until = 0.0
_pause_lock = threading.Lock()


def call_decisions(url, key, body):
    """POST with retries on 429 / 5xx / in-flight-budget 402 / network errors. Returns (json, ms)."""
    global _pause_until
    data = json.dumps(body).encode()
    for attempt in range(MAX_ATTEMPTS):
        wait = _pause_until - time.time()
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "label-script/1.0"})
        t0 = time.time()
        retry_after = None
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                return json.loads(r.read()), (time.time() - t0) * 1000
        except urllib.error.HTTPError as e:
            err = e.read().decode(errors="replace")[:400]
            budget = e.code == 402 and "openrouter_in_flight_budget" in err
            if not (e.code == 429 or e.code >= 500 or budget):
                raise Fatal(f"HTTP {e.code}: {err}") if e.code in (400, 401, 402, 403, 404) else RuntimeError(f"HTTP {e.code}: {err}")
            try:
                retry_after = float(e.headers.get("Retry-After") or "")
            except ValueError:
                pass
            last = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = f"network: {e}"
        if attempt + 1 == MAX_ATTEMPTS:
            raise RuntimeError(f"gave up after {MAX_ATTEMPTS} attempts ({last})")
        backoff = retry_after or min(30.0, 2 ** attempt) + random.random()
        with _pause_lock:
            _pause_until = max(_pause_until, time.time() + backoff)


def confidence_of(a):
    """The answer's `confidence`; if a model omits it, the same concentration measure
    (p_choice - 1/k) / (1 - 1/k) computed from `probabilities`; None if neither is returned."""
    if a.get("confidence") is not None:
        return a["confidence"]
    probs = a.get("probabilities") or {}
    if a.get("choice") in probs and len(probs) > 1:
        k = len(probs)
        return max(0.0, (probs[a["choice"]] - 1 / k) / (1 - 1 / k))
    return None


def to_labels(review_id, keys, answers):
    rows = []
    for k in keys:
        a = answers.get(k) or {}
        if a.get("type") != "choice" or not a.get("choice"):      # refusal / missing
            rows.append((review_id, k, "unsure", None))
            continue
        conf = confidence_of(a)
        sure = conf is None or conf >= MIN_CONFIDENCE              # no signal at all: keep the choice
        rows.append((review_id, k, a["choice"] if sure else "unsure", conf))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="label at most N reviews")
    ap.add_argument("--niche", help="only this niche id")
    ap.add_argument("--dry-run", action="store_true", help="print one request body, no call")
    ap.add_argument("--concurrency", type=int, default=20)
    ap.add_argument("--show", type=int, default=0, help="print the first N raw responses")
    args = ap.parse_args()

    load_env()
    url = os.environ.get("DECISIONS_URL") or "https://openrouter.ai/api/alpha/decisions"
    model = os.environ.get("DECISION_MODEL") or "nace-ai/drex-max"
    key = os.environ.get("OPENROUTER_API_KEY")

    db = sqlite3.connect(DB, timeout=30)
    db.executescript("""
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS review_labels (
            review_id INTEGER NOT NULL, aspect_key TEXT NOT NULL,
            label TEXT NOT NULL, confidence REAL,
            PRIMARY KEY (review_id, aspect_key));
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY, kind TEXT NOT NULL, n_calls INTEGER, ms INTEGER,
            cost_usd REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    """)
    aspects = {}
    for niche_id, k, name, praised, complained in db.execute(
            "SELECT niche_id, key, name, praised_desc, complained_desc FROM aspects ORDER BY rowid"):
        aspects.setdefault(niche_id, []).append((k, name, praised, complained))
    if not aspects:
        sys.exit("no aspects yet - run scripts/aspects.py first")

    where, params = "", []
    if args.niche:
        where, params = "AND p.niche_id = ?", [args.niche]
    todo = db.execute(f"""
        SELECT id, niche_id, niche_name, product, rating, title, text FROM (
            SELECT r.id, p.niche_id, n.name AS niche_name, p.title AS product, r.rating, r.title, r.text,
                   p.rating_number,
                   ROW_NUMBER() OVER (PARTITION BY r.parent_asin ORDER BY r.helpful_votes DESC, r.id) AS rn
            FROM reviews r JOIN products p USING (parent_asin) JOIN niches n ON n.id = p.niche_id
            WHERE p.niche_id IN (SELECT DISTINCT niche_id FROM aspects) {where})
        WHERE id NOT IN (SELECT DISTINCT review_id FROM review_labels)
        ORDER BY (rn - 1) / {REVIEW_TIER}, rating_number DESC, rn
        {"LIMIT ?" if args.limit else ""}""", params + ([args.limit] if args.limit else [])).fetchall()

    def body_for(row):
        rid, niche_id, niche_name, product, stars, title, text = row
        return build_body(model, aspects[niche_id], niche_name, product, stars, title, text)

    if args.dry_run:
        if not todo:
            sys.exit("nothing left to label")
        print(json.dumps(body_for(todo[0]), indent=2))
        print(f"\n{len(todo)} reviews would be labeled ({'key set' if key else 'OPENROUTER_API_KEY missing'}).",
              file=sys.stderr)
        return
    if not key:
        sys.exit("OPENROUTER_API_KEY is missing (root .env)")
    print(f"{len(todo)} reviews to label with {model}, concurrency {args.concurrency}", flush=True)

    def work(row):
        resp, ms = call_decisions(url, key, body_for(row))
        return row, resp, ms

    t_start = time.time()
    n_calls, cost, lat_ms, failed, pending = 0, 0.0, [], 0, []
    pool = ThreadPoolExecutor(args.concurrency)
    futures = [pool.submit(work, row) for row in todo]
    try:
        for fut in as_completed(futures):
            try:
                row, resp, ms = fut.result()
            except Fatal as e:
                print(f"fatal: {e}", file=sys.stderr)
                raise
            except Exception as e:  # noqa: BLE001 - keep going, the review stays unlabeled for a re-run
                failed += 1
                print(f"skip: {e}", file=sys.stderr)
                continue
            n_calls += 1
            lat_ms.append(ms)
            cost += (resp.get("usage") or {}).get("cost") or 0.0
            if n_calls <= args.show:
                print(json.dumps({"review_id": row[0], "ms": round(ms), **resp}, indent=2), flush=True)
            pending += to_labels(row[0], [a[0] for a in aspects[row[1]]], resp.get("answers") or {})
            if n_calls % 100 == 0:
                db.executemany("INSERT OR REPLACE INTO review_labels VALUES (?,?,?,?)", pending)
                db.commit()
                pending = []
            if n_calls % 500 == 0:
                el = time.time() - t_start
                rate = n_calls / el
                print(f"{n_calls}/{len(todo)} done, {rate:.1f}/s, ${cost:.4f}, "
                      f"ETA {(len(todo) - n_calls) / rate / 60:.1f} min, {failed} failed", flush=True)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
        db.executemany("INSERT OR REPLACE INTO review_labels VALUES (?,?,?,?)", pending)
        ms_total = int((time.time() - t_start) * 1000)
        db.execute("INSERT INTO runs (kind, n_calls, ms, cost_usd) VALUES ('label', ?, ?, ?)", (n_calls, ms_total, cost))
        db.commit()
        if n_calls:
            lat_ms.sort()
            print(f"labeled {n_calls} reviews in {ms_total / 1000:.1f}s ({n_calls / (ms_total / 1000):.1f}/s), "
                  f"{failed} failed; latency p50 {lat_ms[len(lat_ms) // 2]:.0f} ms, "
                  f"p90 {lat_ms[int(len(lat_ms) * 0.9)]:.0f} ms; cost ${cost:.5f} "
                  f"(${cost / n_calls:.7f}/call)", flush=True)


if __name__ == "__main__":
    main()
