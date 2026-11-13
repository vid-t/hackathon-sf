"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlertIcon, StarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { Evidence } from "@/lib/types";
import { pct, shortTitle, type EvidenceRequest } from "./format";

export type ReviewsRequest = EvidenceRequest & { id: number; titles: Record<string, string> };

type State = { status: "loading" } | { status: "done"; items: Evidence[] } | { status: "error"; message: string };

/** Side sheet listing the reviews behind a number. Keeps the last request while closing so the exit animation has content. */
export function ReviewsSheet({ request, open, onOpenChange }: { request: ReviewsRequest | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  // Opened from many buttons rather than a SheetTrigger, so return focus to whichever one opened it.
  const opener = useRef<HTMLElement | null>(null);
  const verb = request?.label === "praised" ? "praising" : "complaining about";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          opener.current?.focus();
        }}
      >
        {request ? (
          <>
            <SheetHeader className="border-b pr-12">
              <p className="text-xs text-muted-foreground">
                {request.nicheName}
                {request.productTitle ? ` / ${shortTitle(request.productTitle, 48)}` : null}
              </p>
              <SheetTitle className="text-base leading-snug font-semibold">
                Reviews {verb} <span className={request.label === "praised" ? "text-praise" : "text-complain"}>{request.aspectName.toLowerCase()}</span>
              </SheetTitle>
              <SheetDescription>{request.context ?? "Reviews labelled by Drex."}</SheetDescription>
            </SheetHeader>
            <ReviewList key={request.id} request={request} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ReviewList({ request }: { request: ReviewsRequest }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const q = new URLSearchParams({ niche: request.nicheId, aspect: request.aspectKey, label: request.label });
    if (request.asin) q.set("asin", request.asin);
    fetch(`/api/evidence?${q}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
        setState({ status: "done", items: body as Evidence[] });
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState({ status: "error", message: err.message });
      });
    return () => ctrl.abort();
  }, [request, attempt]);

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain p-4" aria-live="polite" aria-busy={state.status === "loading"}>
      {state.status === "loading" && (
        <ul className="grid gap-6" aria-label="Loading reviews">
          {[0, 1, 2].map((i) => (
            <li key={i} className="grid gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </li>
          ))}
        </ul>
      )}

      {state.status === "error" && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Reviews didn’t load.</AlertTitle>
          <AlertDescription>
            <p>{state.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {state.status === "done" && state.items.length === 0 && (
        <p className="text-muted-foreground">No reviews matched this aspect. Try the other label or another product.</p>
      )}

      {state.status === "done" && state.items.length > 0 && (
        <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out-expo">
          <p className="text-xs text-muted-foreground">
            {state.items.length} reviews, most confident first. Confidence is how sure Drex was about the label.
          </p>
          <ul className="mt-1 divide-y">
            {state.items.map((ev) => (
              <li key={`${ev.review_id}-${ev.asin}`} className="py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <Stars n={ev.stars} />
                  <time dateTime={ev.date}>{formatDate(ev.date)}</time>
                  <span className="ml-auto">
                    Confidence <span className="font-medium text-foreground tabular-nums">{pct(ev.confidence)}</span>
                  </span>
                </div>
                {ev.title ? <p className="mt-2 font-medium">{ev.title}</p> : null}
                <blockquote className="mt-1 leading-relaxed text-pretty">{ev.text}</blockquote>
                {!request.asin && request.titles[ev.asin] ? (
                  <p className="mt-2 text-xs text-muted-foreground">On {shortTitle(request.titles[ev.asin], 56)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span role="img" aria-label={`${n} of 5 stars`} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} aria-hidden className={cn("size-3.5", i <= n ? "fill-current text-foreground" : "text-muted-foreground/40")} />
      ))}
    </span>
  );
}

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
