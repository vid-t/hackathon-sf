// Reads REAL products from ../data/pets.db (the `catalog` table).
// Server-only: uses node:sqlite, so import it from route handlers only.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NicheId } from "./types";

export type CatalogProduct = {
  asin: string;
  title: string;
  brand: string | null;
  price: number | null;
  average_rating: number | null;
  rating_number: number | null;
  image_url: string | null;
};

export const NICHE_PATHS: Record<NicheId, string> = {
  "dog-beds": "Pet Supplies > Dogs > Beds & Furniture > Beds",
  "dog-harnesses": "Pet Supplies > Dogs > Collars, Harnesses & Leashes > Harnesses > Vest Harnesses",
  "dog-chew-toys": "Pet Supplies > Dogs > Toys > Chew Toys",
  "dog-coats": "Pet Supplies > Dogs > Apparel & Accessories > Cold Weather Coats",
  "dog-car-seat-covers": "Pet Supplies > Dogs > Carriers & Travel Products > Car Travel Accessories > Seat Covers",
  "cat-fountains": "Pet Supplies > Cats > Feeding & Watering Supplies > Fountains",
  "cat-trees": "Pet Supplies > Cats > Beds & Furniture > Trees",
  "cat-beds": "Pet Supplies > Cats > Beds & Furniture > Beds",
};

const PER_NICHE = 8;
const DB_PATH = path.join(process.cwd(), "..", "data", "pets.db");

let cache: Map<NicheId, CatalogProduct[]> | null = null;

/** Top products per niche by rating count. Falls back to a static snapshot if the DB is busy or missing. */
export function getCatalog(): Map<NicheId, CatalogProduct[]> {
  if (cache) return cache;
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true, timeout: 2000 });
    try {
      const pathToId = new Map(Object.entries(NICHE_PATHS).map(([id, p]) => [p, id as NicheId]));
      const placeholders = Object.values(NICHE_PATHS).map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT * FROM (
             SELECT parent_asin, niche, title, store, price, average_rating, rating_number, image_url,
                    ROW_NUMBER() OVER (PARTITION BY niche ORDER BY rating_number DESC) AS rn
             FROM catalog WHERE niche IN (${placeholders})
           ) WHERE rn <= ${PER_NICHE} ORDER BY niche, rn`,
        )
        .all(...Object.values(NICHE_PATHS)) as Record<string, string | number | null>[];

      const out = new Map<NicheId, CatalogProduct[]>();
      for (const r of rows) {
        const id = pathToId.get(String(r.niche));
        if (!id) continue;
        const list = out.get(id) ?? [];
        list.push({
          asin: String(r.parent_asin),
          title: String(r.title ?? ""),
          brand: (r.store as string | null) ?? null,
          price: (r.price as number | null) ?? null,
          average_rating: (r.average_rating as number | null) ?? null,
          rating_number: (r.rating_number as number | null) ?? null,
          image_url: (r.image_url as string | null) ?? null,
        });
        out.set(id, list);
      }
      if (out.size < Object.keys(NICHE_PATHS).length) throw new Error("catalog is missing niches");
      cache = out;
      return out;
    } finally {
      db.close();
    }
  } catch (err) {
    // e.g. SQLITE_BUSY while the ingest script writes, or the DB isn't there. Don't cache: retry next request.
    console.warn("[catalog] falling back to static list:", (err as Error).message);
    return FALLBACK;
  }
}

// Snapshot of the top 2 products per niche, taken from the same catalog table.
const img = (id: string) => `https://m.media-amazon.com/images/I/${id}._AC_.jpg`;
const FALLBACK = new Map<NicheId, CatalogProduct[]>([
  ["dog-beds", [
    { asin: "B07YFHMTV2", title: "MidWest Bolster Pet Bed for Dogs & Cats 54L-Inch Cinnamon Dog Bed", brand: "MidWest Homes for Pets", price: 52.36, average_rating: 4.2, rating_number: 79186, image_url: img("41bUugkFJXL") },
    { asin: "B09MF2HCMT", title: "MidWest Homes for Pets Deluxe Dog Beds Super Plush Dog & Cat Beds", brand: "MidWest Homes for Pets", price: 27.99, average_rating: 4.5, rating_number: 76381, image_url: img("41NfutWZkAL") },
  ]],
  ["dog-harnesses", [
    { asin: "B07KYL7MFN", title: "rabbitgoo Dog Harness, No-Pull Pet Harness with 2 Leash Clips, Adjustable", brand: "rabbitgoo", price: 24.98, average_rating: 4.5, rating_number: 152355, image_url: img("41giU88dqRL") },
    { asin: "B0BR9V6F2T", title: "Voyager Step-In Air Dog Harness - All Weather Mesh Step in Vest Harness", brand: "Best Pet Supplies", price: 14.99, average_rating: 4.6, rating_number: 75001, image_url: img("51Q3NDO1cKL") },
  ]],
  ["dog-chew-toys", [
    { asin: "B07QS5N1D8", title: "Benebone Wishbone Durable Dog Chew Toy for Aggressive Chewers", brand: "Benebone", price: 12.52, average_rating: 4.5, rating_number: 84140, image_url: img("31RFJ3sU48L") },
    { asin: "B0115AT2ZW", title: "KONG - Classic Dog Toy, Durable Natural Rubber- Fun to Chew, Chase and Fetch", brand: "KONG", price: 11.99, average_rating: 4.6, rating_number: 80128, image_url: img("31tBVk7WmQL") },
  ]],
  ["dog-coats", [
    { asin: "B08WPXZ2MN", title: "Kuoser Warm Dog Coat, Reversible Dog Jacket Waterproof Dog Winter Coat", brand: "Kuoser", price: 19.99, average_rating: 4.5, rating_number: 51423, image_url: img("51JPqCwP8nL") },
    { asin: "B07HCDJYQN", title: "Vecomfy Fleece Lining Extra Warm Dog Hoodie in Winter for Large Dogs", brand: "vecomfy", price: 25.99, average_rating: 4.5, rating_number: 19225, image_url: img("41LD6Jc7xSL") },
  ]],
  ["dog-car-seat-covers", [
    { asin: "B09ZQ7ZXRL", title: "Active Pets Dog Car Seat Cover for Back Seat - Durable, Nonslip, Waterproof", brand: "Active Pets", price: 33.26, average_rating: 4.6, rating_number: 47127, image_url: img("41Rdw-CmONL") },
    { asin: "B094JNNXKP", title: "URPOWER Dog Seat Cover Car Seat Cover for Pets 100% Waterproof", brand: "URPOWER", price: 41.99, average_rating: 4.6, rating_number: 33440, image_url: img("51nT6enbL+L") },
  ]],
  ["cat-fountains", [
    { asin: "B07QCYVKBL", title: "Veken Pet Fountain, 84oz/2.5L Automatic Cat Water Fountain", brand: "Veken", price: 25.99, average_rating: 4.4, rating_number: 70909, image_url: img("419OO-c9rEL") },
    { asin: "B08WZSPL61", title: "Catit Flower Fountain with Triple Action Filter, Cat Drinking Water Fountain", brand: "Catit", price: 27.83, average_rating: 4.4, rating_number: 42472, image_url: img("31+51a6OcyL") },
  ]],
  ["cat-trees", [
    { asin: "B07J1YVW13", title: "Amazon Basics Cat Tower with Hammock and Scratching Posts for Indoor Cats", brand: "Amazon Basics", price: 29.97, average_rating: 4.7, rating_number: 48309, image_url: img("41ci9kssMxL") },
    { asin: "B07TT4CDBR", title: "54in Cat Tree Tower for Indoor Cats Multi-Level Cat Condo", brand: null, price: 38.99, average_rating: 4.3, rating_number: 36310, image_url: img("416yKTEaBRL") },
  ]],
  ["cat-beds", [
    { asin: "B0C4BFWLNC", title: "Best Friends by Sheri The Original Calming Lux Donut Cuddler", brand: "Best Friends by Sheri", price: 71.99, average_rating: 4.6, rating_number: 68128, image_url: img("41tTQuxqBzL") },
    { asin: "B0C67LVHVD", title: "Coolaroo The Original Cooling Elevated Pet Bed, Indoor and Outdoor", brand: "Coolaroo", price: 28.0, average_rating: 4.6, rating_number: 67500, image_url: img("31Cg-EBAKhL") },
  ]],
]);
