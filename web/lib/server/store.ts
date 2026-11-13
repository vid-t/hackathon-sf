// Fetch a store's content for profiling: Shopify's public /products.json when available,
// otherwise the homepage stripped to readable text. Server-only.

const MAX_CHARS = 15_000;
const MAX_PRODUCTS = 250;
const TIMEOUT_MS = 10_000;
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; store-profiler/1.0)", Accept: "text/html,application/json" };

type ShopifyProduct = {
  title?: string;
  product_type?: string;
  vendor?: string;
  tags?: string[] | string;
  variants?: { price?: string }[];
};

/** "shop.com/x/" -> "https://shop.com/x" (the cache key and the URL we fetch). */
export function normalizeUrl(input: string): string {
  const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
}

async function get(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function pageHead(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1];
  return htmlToText([title && `Title: ${title}`, desc && `Description: ${desc}`].filter(Boolean).join("\n"));
}

function productLines(products: ShopifyProduct[]): string {
  return products
    .slice(0, MAX_PRODUCTS)
    .map((p) => {
      const tags = (Array.isArray(p.tags) ? p.tags : (p.tags ?? "").split(",")).map((t) => t.trim()).filter(Boolean);
      const prices = (p.variants ?? []).map((v) => Number(v.price)).filter((x) => Number.isFinite(x) && x > 0);
      const price = prices.length ? `$${Math.min(...prices).toFixed(2)}` : "";
      return ["-", p.title, p.product_type && `[${p.product_type}]`, p.vendor && `by ${p.vendor}`, price,
        tags.length ? `tags: ${tags.slice(0, 8).join(", ")}` : ""].filter(Boolean).join(" ");
    })
    .join("\n");
}

/** Readable store content, capped at ~15K chars. Throws if nothing could be fetched. */
export async function fetchStoreText(url: string): Promise<string> {
  const origin = new URL(url).origin;
  const [productsRes, pageRes] = await Promise.all([get(`${origin}/products.json?limit=${MAX_PRODUCTS}`), get(url)]);
  const html = pageRes ? await pageRes.text() : "";

  if (productsRes) {
    try {
      const { products } = (await productsRes.json()) as { products?: ShopifyProduct[] };
      if (products?.length) {
        const text = `${pageHead(html)}\n\nProducts (${products.length} listed):\n${productLines(products)}`;
        return text.slice(0, MAX_CHARS);
      }
    } catch {
      // not Shopify JSON: fall through to the page text
    }
  }
  const text = htmlToText(html);
  if (!text) throw new Error(`Could not load ${url}`);
  return text.slice(0, MAX_CHARS);
}
