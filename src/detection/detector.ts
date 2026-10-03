import type { Entity } from "../entities/entity.js";
import type { EntityType } from "../entities/entity-types.js";
import type { InputType } from "../types/input.js";

export interface DetectionInput {
  text: string;
  /** BCP-47 language code or "mixed". Detectors must not assume English. */
  language?: string;
  inputType?: InputType;
  purpose?: string;
  /** Name of the structured field the text came from, if any (e.g. "email"). */
  fieldName?: string;
}

/**
 * A detector finds sensitive spans in text. Detectors return value-free
 * entities with `start`/`end` offsets into `input.text`.
 */
export interface Detector {
  readonly name: string;
  readonly version: string;
  /** Entity types this detector can produce. */
  readonly entityTypes: readonly EntityType[];
  /**
   * Languages this detector supports (BCP-47 primary subtags). Omit for
   * language-independent detectors.
   */
  readonly languages?: readonly string[];
  detect(input: DetectionInput): Promise<Entity[]>;
}

/** Optional named-entity-recognition backend (e.g. a local ML model adapter). */
export type NerDetector = Detector;

const SCRIPT_PATTERNS: [string, RegExp][] = [
  ["hi", /\p{Script=Devanagari}/gu],
  ["ta", /\p{Script=Tamil}/gu],
  ["en", /\p{Script=Latin}/gu],
];

/**
 * Lightweight script-based language guess. Returns "mixed" when more than one
 * script is significant. This is a hint only; detectors run on all scripts.
 */
export function guessLanguage(text: string): string | undefined {
  const sample = text.length > 20_000 ? text.slice(0, 20_000) : text;
  const counts: [string, number][] = SCRIPT_PATTERNS.map(([lang, re]) => [
    lang,
    sample.match(re)?.length ?? 0,
  ]);
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return undefined;
  const significant = counts.filter(([, n]) => n / total >= 0.15);
  if (significant.length > 1) return "mixed";
  return significant[0]?.[0];
}

export function supportsLanguage(detector: Detector, language: string | undefined): boolean {
  if (!detector.languages || detector.languages.length === 0) return true;
  if (!language || language === "mixed") return true;
  const primary = language.toLowerCase().split("-")[0] ?? language;
  return detector.languages.includes(primary) || detector.languages.includes("*");
}
