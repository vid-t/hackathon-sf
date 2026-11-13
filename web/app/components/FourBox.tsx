import type { NicheResult } from "@/lib/types";

export type CellKey = keyof NicheResult["four_box"];

/** The four boxes: Praised / Complained × most / few products. */
export const CELLS: { key: CellKey; title: string; axis: string; label: "praised" | "complained" }[] = [
  { key: "table_stakes", title: "Table stakes", axis: "Praised for most products", label: "praised" },
  { key: "differentiators", title: "Differentiators", axis: "Praised for few products", label: "praised" },
  { key: "gaps", title: "Category gaps", axis: "Complained about for most products", label: "complained" },
  { key: "red_flags", title: "Red flags", axis: "Complained about for few products", label: "complained" },
];
