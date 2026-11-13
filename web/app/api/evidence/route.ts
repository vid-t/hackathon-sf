// GET /api/evidence?niche=&aspect=&label=&asin=  -> Evidence[]
// Node.js runtime (default, required by cacheComponents); reading searchParams makes it request-time.
import type { NextRequest } from "next/server";
import { mockEvidence } from "@/lib/mock";
import { getEvidence } from "@/lib/server/analyze";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const niche = q.get("niche") ?? "";
  const aspect = q.get("aspect") ?? "";
  const label = q.get("label");
  const asin = q.get("asin") || undefined;
  if (label !== "praised" && label !== "complained") {
    return Response.json({ error: "label must be praised or complained" }, { status: 400 });
  }
  try {
    return Response.json(await getEvidence({ niche, aspect, label, asin }));
  } catch (err) {
    // No labels yet: fall back to sample quotes, which the page labels as simulated.
    console.error("[evidence] real query failed, serving sample data:", err);
  }
  const evidence = mockEvidence(niche, aspect, label, asin);
  if (!evidence) {
    return Response.json({ error: `Unknown niche or aspect: ${niche} / ${aspect}` }, { status: 404 });
  }
  return Response.json(evidence, { headers: { "X-ShelfScout-Mock": "1" } });
}
