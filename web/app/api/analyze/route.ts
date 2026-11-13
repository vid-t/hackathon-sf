// POST /api/analyze  { url } -> AnalyzeResponse
// Runs on the Node.js runtime: with cacheComponents enabled (next.config.ts) Node is the only
// runtime and a `runtime` export is not allowed. The handler needs Node for node:sqlite.
import { mockAnalyze } from "@/lib/mock";
import { analyzeStore } from "@/lib/server/analyze";

export async function POST(request: Request) {
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json({ error: "Send JSON like {\"url\": \"https://yourstore.com\"}." }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "Enter your store's web address." }, { status: 400 });
  }
  try {
    return Response.json(await analyzeStore(url.trim()));
  } catch (err) {
    // Missing keys or labels: serve sample data, which the page labels as simulated.
    console.error("[analyze] real pipeline failed, serving sample data:", err);
  }
  try {
    const result = await mockAnalyze(url.trim());
    return Response.json(result, { headers: { "X-ShelfScout-Mock": "1" } });
  } catch (err) {
    console.error("[analyze]", err);
    return Response.json({ error: "The analysis failed. Try again in a moment." }, { status: 500 });
  }
}
