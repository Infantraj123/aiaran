import type { Entity } from "../entities/entity.js";
import type { EntityType } from "../entities/entity-types.js";
import { DetectionError } from "../core/errors.js";
import type { DetectionInput, Detector } from "./detector.js";
import { RegexDetector, type ContextRule } from "./regex-detector.js";

export interface PatternDetectorOptions {
  name?: string;
  entityType: EntityType;
  pattern: RegExp | string;
  confidence?: number;
  /** Capture group containing the sensitive value. */
  group?: number;
  validate?: (value: string) => boolean;
  /** Context keywords (any language) that raise confidence or are required. */
  context?: ContextRule;
}

/** Create a detector from a regular expression. */
export function createPatternDetector(options: PatternDetectorOptions): Detector {
  const pattern =
    typeof options.pattern === "string" ? new RegExp(options.pattern, "u") : options.pattern;
  assertSafePattern(pattern);
  return new RegexDetector(
    options.name ?? `custom.${options.entityType.toLowerCase()}`,
    "custom",
    [
      {
        type: options.entityType,
        id: options.name ?? options.entityType,
        pattern,
        confidence: options.confidence ?? 0.9,
        ...(options.group !== undefined ? { group: options.group } : {}),
        ...(options.validate ? { validate: options.validate } : {}),
        ...(options.context ? { context: options.context } : {}),
        source: "custom",
      },
    ],
    "custom",
  );
}

export type DetectFunction = (input: DetectionInput) => Entity[] | Promise<Entity[]>;

/** Create a detector from a function returning value-free entities. */
export function createFunctionDetector(
  name: string,
  entityTypes: readonly EntityType[],
  fn: DetectFunction,
  version = "custom",
): Detector {
  return {
    name,
    version,
    entityTypes,
    async detect(input: DetectionInput): Promise<Entity[]> {
      const result = await fn(input);
      if (!Array.isArray(result))
        throw new DetectionError(`Custom detector "${name}" must return an array.`);
      return result.map((e) => ({
        ...e,
        source: e.source ?? "custom",
        detector: e.detector ?? name,
      }));
    },
  };
}

/**
 * Reject patterns that can match the empty string, which would produce
 * zero-length entities and loop forever in naive scanners.
 */
function assertSafePattern(pattern: RegExp): void {
  const probe = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
  if (probe.test("")) {
    throw new DetectionError("Custom detector patterns must not match the empty string.");
  }
}
