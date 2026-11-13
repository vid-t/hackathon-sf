"use client";

import { useState, type Ref } from "react";
import { StarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { NicheResult, RankedProduct } from "@/lib/types";
import { CELLS } from "./FourBox";
import { aspectName, count, money, pct, RISK_LABELS, type EvidenceRequest } from "./format";

type Props = {
  niche: NicheResult;
  storeName: string;
  onEvidence: (req: EvidenceRequest) => void;
  headingRef?: Ref<HTMLHeadingElement>;
};

const tone = (label: "praised" | "complained") => (label === "praised" ? "text-praise" : "text-complain");

const TAB_ENTER = "pt-3 animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out-expo";

export function NicheDetail({ niche, storeName, onEvidence, headingRef }: Props) {
  const deciding = aspectName(niche, niche.deciding_aspect);
  // Lives here, outside the keyed wrapper, so the chosen tab survives switching niches.
  const [tab, setTab] = useState("reviews");

  return (
    <Card>
      {/* Keyed by niche so its content fades in fresh on every switch. */}
      <div key={niche.id} className="flex flex-col gap-(--card-spacing) animate-in fade-in duration-300 ease-out-expo">
        <CardHeader>
          <CardTitle>
            <h3 ref={headingRef} tabIndex={-1} className="scroll-mt-4 text-xl font-semibold tracking-tight outline-none">
              {niche.name}
            </h3>
          </CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground tabular-nums">{pct(niche.fit_prob)}</span> fit for {storeName} ·{" "}
            {RISK_LABELS[niche.risk].toLowerCase()} risk · decided by <span className="font-medium text-foreground">{deciding.toLowerCase()}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="reviews">What reviews say</TabsTrigger>
              <TabsTrigger value="products">Products ({niche.ranking.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="reviews" className={TAB_ENTER}>
              <p className="text-muted-foreground">Share of products where reviewers praise or complain about each aspect. Select one to read the reviews.</p>
              <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
                {CELLS.map((cell) => {
                  const items = niche.four_box[cell.key];
                  return (
                    <section key={cell.key} aria-labelledby={`${niche.id}-${cell.key}`}>
                      <h4 id={`${niche.id}-${cell.key}`} className="font-medium">
                        {cell.title}
                      </h4>
                      <p className="text-xs text-muted-foreground">{cell.axis}</p>
                      {items.length ? (
                        <ul className="-mx-2 mt-2 grid">
                          {items.map((it) => (
                            <li key={it.aspect_key}>
                              <button
                                type="button"
                                onClick={() =>
                                  onEvidence({
                                    nicheId: niche.id,
                                    nicheName: niche.name,
                                    aspectKey: it.aspect_key,
                                    aspectName: it.aspect_name,
                                    label: cell.label,
                                    context: `${cell.title}: ${cell.label} for ${pct(it.share_of_products)} of products, in ${pct(it.rate)} of reviews.`,
                                  })
                                }
                                aria-label={`${it.aspect_name}: ${cell.label} for ${pct(it.share_of_products)} of products. Show reviews.`}
                                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block font-medium">{it.aspect_name}</span>
                                  <span className="block text-xs text-muted-foreground">In {pct(it.rate)} of reviews</span>
                                </span>
                                <span className={cn("shrink-0 text-lg font-semibold tabular-nums", tone(cell.label))}>{pct(it.share_of_products)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-muted-foreground">No aspect lands here.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="products" className={TAB_ENTER}>
              <p className="text-muted-foreground">
                Ranked for your store. Bars show the share of recent reviews that praise or complain; select one to read what they say about {deciding.toLowerCase()}.
              </p>
              <ol className="mt-2 divide-y">
                {niche.ranking.map((p, i) => (
                  <RankRow key={p.asin} p={p} rank={i + 1} isStart={p.asin === niche.start_with} niche={niche} deciding={deciding} onEvidence={onEvidence} />
                ))}
              </ol>
            </TabsContent>
          </Tabs>
        </CardContent>
      </div>
    </Card>
  );
}

function RankRow({ p, rank, isStart, niche, deciding, onEvidence }: { p: RankedProduct; rank: number; isStart: boolean; niche: NicheResult; deciding: string; onEvidence: (r: EvidenceRequest) => void }) {
  const open = (label: "praised" | "complained") =>
    onEvidence({
      nicheId: niche.id,
      nicheName: niche.name,
      aspectKey: niche.deciding_aspect,
      aspectName: deciding,
      label,
      asin: p.asin,
      productTitle: p.title,
      context: `${pct((label === "praised" ? p.praise : p.complain) / Math.max(1, p.reviews))} of ${p.reviews} reviews ${label === "praised" ? "praised" : "complained about"} this product. These are the ones about ${deciding.toLowerCase()}.`,
    });
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-3 py-4 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]">
      <ProductImage src={p.image_url} className="size-12 sm:size-14" />
      <div className="min-w-0">
        <a
          href={`https://www.amazon.com/dp/${p.asin}`}
          target="_blank"
          rel="noopener noreferrer"
          title={p.title}
          className="line-clamp-2 font-medium leading-snug underline-offset-4 hover:underline"
        >
          <span className="text-muted-foreground tabular-nums">{rank}.</span> {p.title}
        </a>
        <ProductMeta p={p} />
        {isStart ? (
          <Badge className="mt-2">Start with this one</Badge>
        ) : null}
        <div className="mt-2 grid gap-0.5">
          <ShareBar label="Praised" value={p.praise / Math.max(1, p.reviews)} kind="praised" onClick={() => open("praised")} total={p.reviews} />
          <ShareBar label="Complained" value={p.complain / Math.max(1, p.reviews)} kind="complained" onClick={() => open("complained")} total={p.reviews} />
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg leading-none font-semibold tabular-nums">{Math.round(p.score * 100)}</div>
        <div className="mt-1 text-xs text-muted-foreground">score</div>
      </div>
    </li>
  );
}

function ShareBar({ label, value, kind, total, onClick }: { label: string; value: number; kind: "praised" | "complained"; total: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} in ${pct(value)} of ${total} reviews. Show reviews.`}
      className="-mx-1 grid grid-cols-[5.5rem_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span className={cn("bar-grow block h-full rounded-full", kind === "praised" ? "bg-praise" : "bg-complain")} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className={cn("text-right font-medium tabular-nums", tone(kind))}>{pct(value)}</span>
    </button>
  );
}

function ProductMeta({ p }: { p: RankedProduct }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {p.brand ? <span>{p.brand}</span> : null}
      {money(p.price) ? <span className="font-medium text-foreground tabular-nums">{money(p.price)}</span> : <span>Price not listed</span>}
      {p.average_rating != null ? (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <StarIcon className="size-3 fill-current" aria-hidden />
          <span className="sr-only">Rated </span>
          {p.average_rating.toFixed(1)}
          {p.rating_number != null ? (
            <>
              {" "}({count(p.rating_number)}
              <span className="sr-only"> ratings</span>)
            </>
          ) : null}
        </span>
      ) : null}
    </p>
  );
}

function ProductImage({ src, className = "" }: { src: string | null; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-md bg-white p-1 ring-1 ring-border", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" />
      ) : (
        <span className="text-[10px] text-neutral-500">No image</span>
      )}
    </span>
  );
}
