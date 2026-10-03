import type { Entity, SpanEntity } from "../entities/entity.js";
import { isSpanEntity } from "../entities/entity.js";
import type { EntityRegistry } from "../entities/entity-registry.js";
import type { Warning } from "../types/output.js";
import { supportsLanguage, type DetectionInput, type Detector } from "./detector.js";

export interface DetectionOutcome {
  entities: SpanEntity[];
  warnings: Warning[];
  /** True if any detector failed — the text was not fully inspected. */
  incomplete: boolean;
}

/** Placeholder tokens produced by ARAN, e.g. `[PERSON_001]` or `[EMAIL_REDACTED]`. */
export const ARAN_TOKEN_RE = /\[[A-Z][A-Z0-9_]*_(?:\d{3,}|REDACTED)\]/g;

/**
 * Runs all detectors, validates their output, and resolves overlapping
 * detections into a non-overlapping, ordered entity list.
 */
export class DetectionEngine {
  constructor(
    private readonly detectors: () => readonly Detector[],
    private readonly registry: EntityRegistry,
    private readonly maxEntities: number,
  ) {}

  versions(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.detectors()) out[d.name] = d.version;
    return out;
  }

  async detect(input: DetectionInput): Promise<DetectionOutcome> {
    const warnings: Warning[] = [];
    let incomplete = false;
    if (input.text.length === 0) return { entities: [], warnings, incomplete };

    const active = this.detectors().filter((d) => supportsLanguage(d, input.language));
    const results = await Promise.allSettled(active.map((d) => d.detect(input)));

    const raw: SpanEntity[] = [];
    results.forEach((result, i) => {
      const detector = active[i]!;
      if (result.status === "rejected") {
        incomplete = true;
        warnings.push({
          code: "DETECTOR_FAILED",
          message: `Detector "${detector.name}" failed; text was not fully inspected.`,
          severity: "error",
          incomplete: true,
        });
        return;
      }
      for (const entity of result.value) {
        if (!isValidSpan(entity, input.text.length)) continue;
        raw.push({ ...entity, detector: entity.detector ?? detector.name });
      }
    });

    // Never treat ARAN's own placeholders as sensitive values.
    const tokenSpans = findTokenSpans(input.text);
    const filtered = tokenSpans.length > 0 ? raw.filter((e) => !insideAny(e, tokenSpans)) : raw;

    let entities = this.resolveOverlaps(filtered);
    if (entities.length > this.maxEntities) {
      entities = entities.slice(0, this.maxEntities);
      incomplete = true;
      warnings.push({
        code: "ENTITY_LIMIT_REACHED",
        message: `More than ${this.maxEntities} entities detected; remaining content was not protected.`,
        severity: "error",
        incomplete: true,
      });
    }
    entities.forEach((e, i) => (e.id = `E${i + 1}`));
    return { entities, warnings, incomplete };
  }

  /**
   * Greedy overlap resolution. Candidates are ranked by confidence plus a
   * small category-priority bonus; near-ties prefer the longer span. The
   * winner of each overlapping cluster is kept.
   */
  resolveOverlaps(entities: SpanEntity[]): SpanEntity[] {
    const score = (e: SpanEntity): number => e.confidence + this.registry.priority(e.type) * 0.002;
    const ranked = [...entities].sort((a, b) => {
      const diff = score(b) - score(a);
      if (Math.abs(diff) >= 0.05) return diff;
      const lenDiff = b.end - b.start - (a.end - a.start);
      return lenDiff !== 0 ? lenDiff : diff;
    });
    // `kept` stays sorted by start and non-overlapping, so a binary search
    // finds the only neighbours a candidate could overlap.
    const kept: SpanEntity[] = [];
    for (const candidate of ranked) {
      let lo = 0;
      let hi = kept.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (kept[mid]!.start < candidate.start) lo = mid + 1;
        else hi = mid;
      }
      const prev = kept[lo - 1];
      const next = kept[lo];
      if (prev && prev.end > candidate.start) continue;
      if (next && next.start < candidate.end) continue;
      kept.splice(lo, 0, candidate);
    }
    return kept;
  }
}

function isValidSpan(entity: Entity, length: number): entity is SpanEntity {
  return (
    isSpanEntity(entity) &&
    Number.isInteger(entity.start) &&
    Number.isInteger(entity.end) &&
    entity.start >= 0 &&
    entity.end <= length &&
    entity.end > entity.start &&
    typeof entity.type === "string" &&
    typeof entity.confidence === "number" &&
    Number.isFinite(entity.confidence)
  );
}

export function findTokenSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  ARAN_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ARAN_TOKEN_RE.exec(text)) !== null)
    spans.push({ start: m.index, end: m.index + m[0].length });
  return spans;
}

function insideAny(e: SpanEntity, spans: { start: number; end: number }[]): boolean {
  return spans.some((s) => e.start < s.end && s.start < e.end);
}
