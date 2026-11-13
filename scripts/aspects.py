"""Write the 6-8 aspects buyers judge in each niche into table `aspects`.

The aspects below were written by hand from each niche's most helpful 1-2 star and
5 star reviews. They become Drex's labelling questions, so `praised` / `complained`
stay at 8 words or fewer (they are resent on every call). Skips shipping, seller
service and price: only the product itself.

Run: python3 scripts/aspects.py [--niche ID] [--force]
"""
import argparse
import pathlib
import sqlite3
import sys

DB = pathlib.Path(__file__).resolve().parent.parent / "data" / "pets.db"

# niche_id -> [(key, name, praised, complained)]
ASPECTS = {
    "dog-beds": [
        ("support", "Support", "Stays plush and supportive", "Flattens or loses cushion quickly"),
        ("durability", "Durability", "Holds up to long use", "Seams split or falls apart"),
        ("washability", "Washability", "Cover washes well, comes off easily", "Falls apart or shrinks when washed"),
        ("waterproofing", "Waterproofing", "Liner keeps accidents out of foam", "Leaks through, foam soaks or smells"),
        ("sizing", "Size accuracy", "Size and look match the listing", "Smaller or different than pictured"),
        ("pet_acceptance", "Dog likes it", "Dog loves sleeping on it", "Dog ignores, refuses or chews it"),
        ("materials_safety", "Materials & smell", "Safe materials, no odor", "Chemical smell, rash or loose stuffing"),
    ],
    "dog-harnesses": [
        ("strength", "Strength", "Straps, stitching and buckles hold", "Buckle, clip or stitching breaks"),
        ("escape_proof", "Escape-proof", "Dog cannot slip out", "Dog slips or backs out"),
        ("fit", "Fit & sizing", "Fits as the size chart says", "Runs small or large, poor fit"),
        ("pull_control", "Pull control", "Reduces pulling, good control", "Does not stop pulling"),
        ("comfort", "Comfort", "No rubbing, moves freely", "Chafes or restricts movement"),
        ("adjustability", "Adjustability", "Easy on and off, stays adjusted", "Straps loosen or hard to fasten"),
    ],
    "dog-chew-toys": [
        ("durability", "Durability", "Lasts even with heavy chewers", "Destroyed within minutes or days"),
        ("safety", "Safety", "Safe, no shards or injuries", "Shards, choking, bleeding gums or vet visit"),
        ("engagement", "Engagement", "Dog loves it, stays busy", "Dog shows no interest"),
        ("size_fit", "Size", "Right size for the dog", "Too small or too big"),
        ("scent_flavor", "Scent & flavor", "Flavor or scent attracts the dog", "Bad smell or flavor fades fast"),
        ("cleaning", "Easy to clean", "Easy to clean", "Gets gross, hard to clean"),
    ],
    "dog-coats": [
        ("sizing", "Sizing", "Fits true to size", "Runs small or wrong size"),
        ("warmth", "Warmth", "Keeps the dog warm", "Too thin, not warm"),
        ("water_resistance", "Water resistance", "Repels rain and snow", "Soaks through when wet"),
        ("fasteners", "Fasteners", "Velcro, snaps and zippers hold", "Velcro or snaps fail"),
        ("coverage", "Coverage", "Covers back and chest well", "Too short or covers too little"),
        ("ease_on_off", "Easy on/off", "Easy to put on and take off", "Hard to put on, dog resists"),
        ("build_quality", "Build quality", "Well made, durable fabric", "Tears, pills or arrives used"),
    ],
    "dog-car-seat-covers": [
        ("vehicle_fit", "Vehicle fit", "Fits the car seat well", "Does not fit, too narrow or short"),
        ("waterproofing", "Waterproofing", "Blocks spills and accidents", "Leaks onto the car seat"),
        ("durability", "Durability", "Holds up to dogs and claws", "Tears or seams rip quickly"),
        ("hardware", "Straps & zippers", "Straps, clips and zipper hold", "Straps, clips or zipper break"),
        ("stays_put", "Stays in place", "Stays put, nonslip", "Slides, bunches or falls down"),
        ("installation", "Installation", "Quick and easy to install", "Hard to install"),
    ],
    "cat-fountains": [
        ("pump_reliability", "Pump reliability", "Pump runs reliably for months", "Pump stops or dies"),
        ("noise", "Noise", "Quiet operation", "Noisy, hums or splashes"),
        ("cleaning", "Easy to clean", "Easy to take apart and clean", "Hard to clean, too many parts"),
        ("hygiene", "Water hygiene", "Water stays fresh and clean", "Mold, slime or dirty water"),
        ("filters", "Filters", "Filters work, easy to replace", "Poor or pricey filters, blackens water"),
        ("leaks", "Leaks", "No leaks", "Leaks or cracks"),
        ("cat_acceptance", "Cats use it", "Cats drink more from it", "Cats ignore or avoid it"),
    ],
    "cat-trees": [
        ("stability", "Stability", "Sturdy, does not wobble", "Wobbly or tips over"),
        ("durability", "Durability", "Holds up to climbing and play", "Perches break or falls apart"),
        ("assembly", "Assembly", "Easy to assemble", "Misaligned holes, hard to assemble"),
        ("materials", "Materials", "Solid, quality materials", "Cardboard or cheap particleboard"),
        ("size_space", "Size & space", "Roomy perches and beds", "Too small for adult cats"),
        ("scratching", "Scratching posts", "Posts satisfy scratching", "Sisal unravels or wears quickly"),
        ("cat_acceptance", "Cats use it", "Cats love using it", "Cats ignore it"),
    ],
    "cat-beds": [
        ("comfort", "Comfort", "Soft, plush and cozy", "Thin, flat, little cushion"),
        ("safety", "Safety", "Safe design for pets", "Choking hazard or shedding fuzz"),
        ("odor", "Odor", "No smell out of the box", "Strong chemical odor"),
        ("shape", "Holds shape", "Holds its shape", "Collapses or loses shape"),
        ("washability", "Washability", "Washes well", "Ruined after washing"),
        ("warmth", "Warmth", "Keeps the pet warm", "Does not stay warm"),
        ("cat_acceptance", "Cat uses it", "Cat uses it constantly", "Cat refuses it"),
    ],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--niche", help="only this niche id")
    ap.add_argument("--force", action="store_true",
                    help="replace aspects even if the niche already has review_labels (deletes those labels)")
    args = ap.parse_args()

    db = sqlite3.connect(DB)
    db.execute("""CREATE TABLE IF NOT EXISTS aspects (
        niche_id TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL,
        praised_desc TEXT NOT NULL, complained_desc TEXT NOT NULL,
        PRIMARY KEY (niche_id, key))""")
    niches = db.execute("SELECT id, name FROM niches" + (" WHERE id = ?" if args.niche else ""),
                        (args.niche,) if args.niche else ()).fetchall()
    if not niches:
        sys.exit(f"unknown niche {args.niche!r}")

    has_labels = db.execute("SELECT 1 FROM sqlite_master WHERE name = 'review_labels'").fetchone()
    if has_labels and not args.force:
        labeled = [n for n, _ in niches if db.execute("""
            SELECT 1 FROM review_labels l JOIN reviews r ON r.id = l.review_id
            JOIN products p USING (parent_asin) WHERE p.niche_id = ? LIMIT 1""", (n,)).fetchone()]
        if labeled:
            sys.exit(f"{labeled} already have review_labels; new aspect keys would orphan them. "
                     "Use --niche for the others, or --force to replace and delete those labels.")

    for niche_id, name in niches:
        if args.force and has_labels:
            db.execute("""DELETE FROM review_labels WHERE review_id IN (
                SELECT r.id FROM reviews r JOIN products p USING (parent_asin) WHERE p.niche_id = ?)""", (niche_id,))
        db.execute("DELETE FROM aspects WHERE niche_id = ?", (niche_id,))
        db.executemany("INSERT INTO aspects VALUES (?,?,?,?,?)",
                       [(niche_id, *a) for a in ASPECTS[niche_id]])
        print(f"\n{name} ({niche_id})")
        for key, aname, praised, complained in ASPECTS[niche_id]:
            print(f"  {key:<18} {aname:<18} + {praised:<38} - {complained}")
    db.commit()


if __name__ == "__main__":
    main()
