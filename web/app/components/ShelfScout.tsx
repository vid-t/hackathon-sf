"use client";

import { useRef, useState, type FormEvent } from "react";
import { CircleAlertIcon, CircleCheckIcon, CircleIcon, PawPrintIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { EXAMPLE_STORES } from "@/lib/examples";
import { cn } from "@/lib/utils";
import type { AnalyzeResponse } from "@/lib/types";
import { ReviewsSheet, type ReviewsRequest } from "./EvidenceSheet";
import { hostOf, normalizeUrl, type EvidenceRequest } from "./format";
import { Results } from "./Results";

type Status = "idle" | "loading" | "done" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ShelfScout() {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [step, setStep] = useState(0);
  const [loadingUrl, setLoadingUrl] = useState("");
  const [jevCalls, setJevCalls] = useState<number | null>(null);
  const [data, setData] = useState<{ result: AnalyzeResponse; mock: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewsRequest | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const run = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function analyze(raw: string) {
    const url = normalizeUrl(raw);
    if (!url) {
      setInputError("Enter a web address like yourstore.com.");
      inputRef.current?.focus();
      return;
    }
    setInputError(null);
    const id = ++run.current;
    setStatus("loading");
    setStep(0);
    setJevCalls(null);
    setError(null);
    setLoadingUrl(url);
    setAnnounce(`Analyzing ${hostOf(url)}`);
    const timers = [setTimeout(() => run.current === id && setStep(1), 450), setTimeout(() => run.current === id && setStep(2), 1000)];

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
      if (run.current !== id) return;
      const result = body as AnalyzeResponse;
      timers.forEach(clearTimeout);
      setJevCalls(result.stats.jev_calls);
      setStep(3);
      await sleep(550);
      if (run.current !== id) return;
      setData({ result, mock: res.headers.get("X-ShelfScout-Mock") === "1" });
      setStatus("done");
      setAnnounce(`Results ready for ${result.store.name}. ${result.niches[0]?.name ?? ""} fits best.`);
    } catch (err) {
      timers.forEach(clearTimeout);
      if (run.current !== id) return;
      const msg = err instanceof TypeError ? "Couldn’t reach the server. Check your connection and try again." : (err as Error).message;
      setError(msg);
      setStatus("error");
      setAnnounce(`Analysis failed. ${msg}`);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    analyze(input);
  }

  function openReviews(req: EvidenceRequest) {
    const niche = data?.result.niches.find((n) => n.id === req.nicheId);
    const titles = Object.fromEntries((niche?.ranking ?? []).map((p) => [p.asin, p.title]));
    setReviews({ ...req, id: Date.now(), titles });
    setReviewsOpen(true);
  }

  const loading = status === "loading";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <p className="flex items-center gap-2 font-semibold tracking-tight">
            <PawPrintIcon className="size-5" aria-hidden />
            ShelfScout
          </p>
          <p className="hidden text-sm text-muted-foreground sm:block">Built on ~40,000 Amazon pet-supply reviews</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <section aria-labelledby="hero-title" className="max-w-2xl">
          <h1 id="hero-title" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Which pet products should your store stock?
          </h1>
          <p className="mt-3 text-base text-pretty text-muted-foreground">
            Paste a store link. Gemini profiles the store, then Drex ranks eight pet-supply niches for it from thousands of real Amazon reviews.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-2">
            <Label htmlFor="store-url">Store web address</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                ref={inputRef}
                id="store-url"
                name="url"
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder="yourstore.com"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (inputError) setInputError(null);
                }}
                aria-invalid={inputError ? true : undefined}
                aria-describedby={inputError ? "url-error" : undefined}
                className="h-10 text-base sm:flex-1 md:text-sm"
              />
              <Button type="submit" size="lg" disabled={loading} className="h-10 px-4">
                {loading ? (
                  <>
                    <Spinner aria-hidden /> Analyzing…
                  </>
                ) : (
                  "Analyze store"
                )}
              </Button>
            </div>
            {inputError ? (
              <p id="url-error" className="text-sm text-destructive">
                {inputError}
              </p>
            ) : null}
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span id="examples-label" className="text-sm text-muted-foreground">
              Or try a real store:
            </span>
            <ul aria-labelledby="examples-label" className="contents">
              {EXAMPLE_STORES.map((s) => (
                <li key={s.url}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => {
                      setInput(s.url);
                      analyze(s.url);
                    }}
                  >
                    {s.name}
                    <span className="font-normal text-muted-foreground">{s.kind}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>

        <div className="mt-12">
          {loading && <Pipeline step={step} url={loadingUrl} jevCalls={jevCalls} />}
          {status === "error" && (
            <Alert variant="destructive" className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out-expo">
              <CircleAlertIcon />
              <AlertTitle>The analysis didn’t finish.</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => analyze(loadingUrl || input)}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {status === "done" && data && (
            <Results key={`${data.result.store.url}-${data.result.stats.ms}`} data={data.result} mock={data.mock} onEvidence={openReviews} />
          )}
        </div>
      </main>

      <footer className="border-t">
        <p className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-pretty text-muted-foreground sm:px-6">
          Reviews from Amazon Reviews 2023 (McAuley Lab), Pet Supplies. Store profiles and the overview by Gemini; review labels and verdicts by Drex Max, a decision model.
        </p>
      </footer>

      <ReviewsSheet request={reviews} open={reviewsOpen} onOpenChange={setReviewsOpen} />
    </div>
  );
}

const STEPS = [
  { label: "Reading store", detail: (url: string) => hostOf(url) },
  { label: "Profiling store (Gemini)", detail: () => "Animals, price band, shoppers and feel" },
  { label: "Drex deciding", detail: () => "How much each aspect matters to this store, then a verdict per niche" },
  { label: "Writing overview (Gemini)", detail: () => "From the numbers only" },
];

function Pipeline({ step, url, jevCalls }: { step: number; url: string; jevCalls: number | null }) {
  return (
    <Card className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out-expo">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Analyzing {hostOf(url)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-4">
          {STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step ? "active" : "pending";
            const label = i === 2 && jevCalls != null ? `${s.label} (${jevCalls} decisions)` : s.label;
            return (
              <li key={s.label} className="flex items-start gap-3" aria-current={state === "active" ? "step" : undefined}>
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center" aria-hidden>
                  {state === "done" ? (
                    <CircleCheckIcon className="size-4 animate-in zoom-in-50 fade-in duration-300 ease-out-expo" />
                  ) : state === "active" ? (
                    <Spinner />
                  ) : (
                    <CircleIcon className="size-4 text-muted-foreground/50" />
                  )}
                </span>
                <div>
                  <p className={cn("transition-colors duration-300", state === "pending" ? "text-muted-foreground" : "font-medium")}>
                    {label}
                    <span className="sr-only">{state === "done" ? ", done" : state === "active" ? ", in progress" : ", waiting"}</span>
                  </p>
                  <p className="text-muted-foreground">{s.detail(url)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
