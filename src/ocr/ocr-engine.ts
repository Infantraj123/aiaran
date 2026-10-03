import type { BoundingBox } from "../entities/entity-types.js";

export interface OcrWord {
  text: string;
  /** 0–100 */
  confidence: number;
  bbox: BoundingBox;
  /** Line index, used to rebuild reading order and line breaks. */
  line: number;
}

export interface OcrResult {
  words: OcrWord[];
  /** Mean word confidence, 0–100. */
  confidence: number;
}

export interface OcrOptions {
  /** Tesseract-style language codes, e.g. ["eng", "hin", "tam"]. */
  languages?: string[];
}

/**
 * OCR backend. The default implementation runs Tesseract locally (WASM in
 * worker threads); images are never sent to a remote service by ARAN.
 */
export interface OcrEngine {
  readonly name: string;
  readonly version: string;
  extract(image: Buffer, options?: OcrOptions): Promise<OcrResult>;
  dispose?(): Promise<void>;
}

export interface OcrLayout {
  text: string;
  /** Character range of each word within `text`. */
  ranges: { start: number; end: number; word: OcrWord }[];
}

/** Rebuild plain text from OCR words, keeping word → character-range mapping. */
export function layoutOcrText(words: readonly OcrWord[]): OcrLayout {
  let text = "";
  const ranges: OcrLayout["ranges"] = [];
  let currentLine: number | undefined;
  for (const word of words) {
    if (word.text.length === 0) continue;
    if (currentLine !== undefined) text += word.line === currentLine ? " " : "\n";
    currentLine = word.line;
    const start = text.length;
    text += word.text;
    ranges.push({ start, end: text.length, word });
  }
  return { text, ranges };
}

/** Bounding boxes (one per line) covering the words that overlap [start, end). */
export function boxesForSpan(
  layout: OcrLayout,
  start: number,
  end: number,
  padding = 2,
): BoundingBox[] {
  const byLine = new Map<number, BoundingBox>();
  for (const r of layout.ranges) {
    if (r.end <= start || r.start >= end) continue;
    const b = r.word.bbox;
    const existing = byLine.get(r.word.line);
    byLine.set(r.word.line, existing ? union(existing, b) : { ...b });
  }
  return [...byLine.values()].map((b) => pad(b, padding));
}

export function union(a: BoundingBox, b: BoundingBox): BoundingBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function pad(b: BoundingBox, p: number): BoundingBox {
  return {
    x: Math.max(0, b.x - p),
    y: Math.max(0, b.y - p),
    width: b.width + 2 * p,
    height: b.height + 2 * p,
  };
}
