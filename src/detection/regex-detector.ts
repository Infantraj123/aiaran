import type { Entity } from "../entities/entity.js";
import type { DetectionSource, EntityType } from "../entities/entity-types.js";
import type { DetectionInput, Detector } from "./detector.js";

/** Unicode-aware word boundaries (JavaScript `\b` is ASCII-only). */
export const WB = String.raw`(?<![\p{L}\p{N}_])`;
export const WE = String.raw`(?![\p{L}\p{N}_])`;

export interface ContextRule {
  /** Lower-case keywords in any language. */
  keywords: readonly string[];
  /** Characters to inspect before the match (default 40). */
  windowBefore?: number;
  /** Characters to inspect after the match (default 20). */
  windowAfter?: number;
  /** Confidence added when a keyword is present (default 0.1). */
  boost?: number;
  /** Drop the match if no keyword is present. */
  required?: boolean;
}

export interface PatternRule {
  type: EntityType;
  /** Rule identifier, reported in entity metadata. */
  id: string;
  pattern: RegExp;
  confidence: number;
  /** Capture group containing the sensitive value (default: whole match). */
  group?: number;
  /** Plausibility/checksum validator. Invalid matches are dropped unless `invalidConfidence` applies. */
  validate?: (value: string, text: string, start: number) => boolean;
  /** Confidence used when validation fails but a context keyword is present. */
  invalidConfidence?: number;
  /** Dynamic entity type (e.g. URL vs INTERNAL_URL). */
  classify?: (value: string) => { type: EntityType; confidence?: number } | undefined;
  context?: ContextRule;
  /** Optional negative context: lowers confidence when `pattern` matches the text just before the value. */
  negativeContext?: { pattern: RegExp; windowBefore?: number; penalty: number };
  /** Trim trailing punctuation from the value (URLs, addresses). */
  trimTrailing?: RegExp;
  source?: DetectionSource;
}

function withFlags(re: RegExp): RegExp {
  const flags = new Set(re.flags.split(""));
  flags.add("g");
  flags.add("d");
  return new RegExp(re.source, [...flags].join(""));
}

/**
 * Generic regex-based detector with validators and multilingual context
 * keywords. Built-in PII and secret detectors are configured instances.
 */
export class RegexDetector implements Detector {
  readonly entityTypes: readonly EntityType[];
  readonly languages?: readonly string[];
  private readonly rules: (PatternRule & { compiled: RegExp })[];

  constructor(
    readonly name: string,
    readonly version: string,
    rules: readonly PatternRule[],
    private readonly defaultSource: DetectionSource = "regex",
  ) {
    this.rules = rules.map((rule) => ({ ...rule, compiled: withFlags(rule.pattern) }));
    this.entityTypes = [...new Set(rules.map((r) => r.type))];
  }

  async detect(input: DetectionInput): Promise<Entity[]> {
    return this.detectSync(input.text);
  }

  detectSync(text: string): Entity[] {
    const entities: Entity[] = [];
    const lower = text.toLowerCase();
    for (const rule of this.rules) {
      const re = rule.compiled;
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        if (match[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        const groupIndex = rule.group ?? 0;
        const indices = match.indices?.[groupIndex];
        let value = match[groupIndex];
        if (!indices || value === undefined) continue;
        let start = indices[0];
        if (rule.trimTrailing) value = value.replace(rule.trimTrailing, "");
        start += value.length - value.trimStart().length;
        value = value.trim();
        const end = start + value.length;
        if (value.length === 0) continue;

        const hasContext = rule.context ? contextHit(lower, start, end, rule.context) : false;
        if (rule.context?.required && !hasContext) continue;

        let confidence = rule.confidence;
        let type = rule.type;
        if (rule.validate && !rule.validate(value, text, start)) {
          if (rule.invalidConfidence !== undefined && hasContext)
            confidence = rule.invalidConfidence;
          else continue;
        } else if (hasContext && rule.context && !rule.context.required) {
          confidence += rule.context.boost ?? 0.1;
        }
        if (rule.negativeContext) {
          const before = lower.slice(
            Math.max(0, start - (rule.negativeContext.windowBefore ?? 15)),
            start,
          );
          if (rule.negativeContext.pattern.test(before)) {
            confidence -= rule.negativeContext.penalty;
          }
        }
        if (rule.classify) {
          const cls = rule.classify(value);
          if (!cls) continue;
          type = cls.type;
          if (cls.confidence !== undefined) confidence = cls.confidence;
        }

        entities.push({
          id: "",
          type,
          start,
          end,
          confidence: clamp(confidence),
          source: rule.source ?? this.defaultSource,
          detector: this.name,
          metadata: { rule: rule.id, ...(hasContext ? { context: true } : {}) },
        });
      }
    }
    return entities;
  }
}

function contextHit(lower: string, start: number, end: number, rule: ContextRule): boolean {
  const before = lower.slice(Math.max(0, start - (rule.windowBefore ?? 40)), start);
  const after = lower.slice(end, end + (rule.windowAfter ?? 20));
  return rule.keywords.some((k) => before.includes(k) || after.includes(k));
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Build a pattern for "<label> <separator> <value>" constructs, where the
 * label is case-insensitive and multilingual. The value is capture group 1.
 */
export function labelled(labels: readonly string[], value: string, flags = "iu"): RegExp {
  const alternatives = labels.map(escapeRegExp).join("|");
  return new RegExp(
    String.raw`(?<![\p{L}\p{N}_])(?:${alternatives})(?:\s*(?:no\.?|number|num|#|id|code))?\s*(?:is|was|[:=#\-–]|\s)\s*["'(]?(${value})`,
    flags,
  );
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
}
