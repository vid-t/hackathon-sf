import type { NicheId, NicheResult } from "@/lib/types";

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const money = (x: number | null) => (x == null ? null : `$${x.toFixed(2)}`);
export const count = (x: number) => x.toLocaleString("en-US");
export const RISK_LABELS = ["Very low", "Low", "Moderate", "High", "Very high"] as const;

export function aspectName(niche: NicheResult, key: string): string {
  const hit = Object.values(niche.four_box).flat().find((a) => a.aspect_key === key);
  return hit?.aspect_name ?? key.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function shortTitle(title: string, max = 60): string {
  const cut = title.split(/[,|–—(]/)[0].trim();
  const s = cut.length >= 12 ? cut : title;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Accepts "yourstore.com" or a full URL; returns a normalized https URL or null. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes(".")) return null;
    return u.origin + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return null;
  }
}

export type EvidenceRequest = {
  nicheId: NicheId;
  nicheName: string;
  aspectKey: string;
  aspectName: string;
  label: "praised" | "complained";
  asin?: string;
  productTitle?: string;
  /** What the number the user clicked says, e.g. "78% of products". */
  context?: string;
};
