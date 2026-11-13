import { Fragment, type ReactNode } from "react";

// Minimal, safe markdown: ## / ### headings, "- " lists, paragraphs, **bold**, *italic*.
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flush = () => {
    if (para.length) {
      blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
      para = [];
    }
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-2 pl-5 marker:text-muted-foreground">
          {list.map((li, i) => <li key={i}>{inline(li)}</li>)}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push(
        <h3 key={blocks.length} className="pt-3 font-semibold tracking-tight first:pt-0">
          {inline(h[2])}
        </h3>,
      );
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (para.length) flush();
      list.push(li[1]);
      continue;
    }
    if (list.length) flush();
    para.push(line);
  }
  flush();

  return <div className="space-y-4">{blocks}</div>;
}
