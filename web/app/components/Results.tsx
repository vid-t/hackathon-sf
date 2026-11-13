"use client";

import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyzeResponse, NicheId, NicheResult } from "@/lib/types";
import { aspectName, hostOf, pct, RISK_LABELS, type EvidenceRequest } from "./format";
import { Markdown } from "./Markdown";
import { NicheDetail } from "./NicheDetail";

/** Entrance for each results block: fade up with an exponential ease-out. */
const REVEAL = "animate-in fade-in slide-in-from-bottom-3 duration-700 ease-out-expo fill-mode-backwards";

type Props = { data: AnalyzeResponse; mock: boolean; onEvidence: (req: EvidenceRequest) => void };

export function Results({ data, mock, onEvidence }: Props) {
  const [selected, setSelected] = useState<NicheId | undefined>(data.niches[0]?.id);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const niche = data.niches.find((n) => n.id === selected) ?? data.niches[0];
  const { store, stats } = data;

  function select(id: NicheId) {
    setSelected(id);
    // Below the two-column breakpoint the detail sits under the list: bring it into view.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => {
        detailHeading.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
        detailHeading.current?.focus({ preventScroll: true });
      });
    }
  }

  const animals = store.animals.length === 2 ? "Dogs and cats" : store.animals[0] === "dog" ? "Dogs" : "Cats";

  return (
    <div className="grid gap-12">
      {/* Store profile */}
      <Card className={REVEAL}>
        <CardHeader>
          <CardTitle>
            <h2 className="text-2xl font-semibold tracking-tight">{store.name}</h2>
          </CardTitle>
          <CardDescription>
            <a href={store.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4 hover:text-foreground">
              {hostOf(store.url)}
            </a>{" "}
            · profiled by Gemini
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-10">
          <p className="max-w-prose text-base leading-relaxed text-pretty">{store.summary}</p>
          <dl className="grid grid-cols-2 content-start gap-x-6 gap-y-3">
            <Fact label="Sells for">{animals}</Fact>
            <Fact label="Price band">
              <span className="tabular-nums">
                ${store.price_band[0]}–${store.price_band[1]}
              </span>
            </Fact>
            <Fact label="Shoppers" wide>
              {store.audience}
            </Fact>
            <Fact label="Feel" wide>
              {store.feel}
            </Fact>
          </dl>
        </CardContent>
        <CardFooter className="flex-wrap gap-x-4 gap-y-2 border-t text-muted-foreground">
          <span>
            <span className="font-medium text-foreground tabular-nums">{stats.jev_calls}</span> Drex decisions
          </span>
          <span>
            <span className="font-medium text-foreground tabular-nums">{(stats.ms / 1000).toFixed(1)} s</span>
          </span>
          <span>
            <span className="font-medium text-foreground tabular-nums">${stats.cost_usd.toFixed(3)}</span> cost
          </span>
          {mock ? (
            <span className="flex items-center gap-2 sm:ml-auto">
              <Badge variant="secondary">Sample data</Badge>
              Scores and quotes are simulated
            </span>
          ) : null}
        </CardFooter>
      </Card>

      {/* Niches */}
      <section aria-labelledby="niches-title" className={cn("grid gap-4 delay-150", REVEAL)}>
        <div>
          <h2 id="niches-title" className="text-xl font-semibold tracking-tight">
            Niches ranked by fit
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Drex’s verdict on all eight niches for {store.name}. Select one to see the reviews behind it.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
          <ul className="grid gap-2" aria-label="Niches">
            {data.niches.map((n, i) => (
              <li key={n.id}>
                <NicheRow niche={n} index={i} selected={n.id === niche?.id} onSelect={() => select(n.id)} />
              </li>
            ))}
          </ul>
          {niche ? <NicheDetail niche={niche} storeName={store.name} onEvidence={onEvidence} headingRef={detailHeading} /> : null}
        </div>
      </section>

      {/* Overview */}
      <section aria-labelledby="overview-title" className={cn("grid gap-4 border-t pt-10 delay-300", REVEAL)}>
        <div>
          <h2 id="overview-title" className="text-xl font-semibold tracking-tight">
            Overview
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Written by Gemini from the numbers on this page, nothing else.</p>
        </div>
        <div className="max-w-prose leading-relaxed">
          <Markdown source={data.overview_md} />
        </div>
      </section>
    </div>
  );
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function verdict(p: number) {
  if (p >= 0.6) return { label: "Fits", variant: "default" as const };
  if (p >= 0.35) return { label: "Maybe", variant: "secondary" as const };
  return { label: "Skip", variant: "outline" as const };
}

function NicheRow({ niche, index, selected, onSelect }: { niche: NicheResult; index: number; selected: boolean; onSelect: () => void }) {
  const v = verdict(niche.fit_prob);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-4 rounded-lg border bg-card p-3 text-left transition-[background-color,border-color,box-shadow] duration-200 outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-primary bg-muted/50 ring-1 ring-primary",
      )}
    >
      <span className="w-14 shrink-0 text-2xl font-semibold tracking-tight tabular-nums">
        {Math.round(niche.fit_prob * 100)}
        <span className="text-sm font-normal text-muted-foreground">%</span>
      </span>
      <span className="grid min-w-0 flex-1 gap-1.5">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{niche.name}</span>
          <Badge variant={v.variant}>{v.label}</Badge>
        </span>
        <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className="bar-grow block h-full rounded-full bg-primary"
            style={{ width: pct(niche.fit_prob), animationDelay: `${250 + index * 50}ms` }}
          />
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {RISK_LABELS[niche.risk]} risk · decided by {aspectName(niche, niche.deciding_aspect).toLowerCase()}
        </span>
      </span>
    </button>
  );
}
