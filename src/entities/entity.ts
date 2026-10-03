import type { BoundingBox, DetectionSource, EntityType } from "./entity-types.js";

/**
 * A detected sensitive span. Entities deliberately do NOT carry the matched
 * value: the pipeline derives it from `start`/`end` internally so that entity
 * objects can be logged, audited or returned without leaking data.
 */
export interface Entity {
  id: string;
  type: EntityType;
  start?: number;
  end?: number;
  confidence: number;
  source: DetectionSource;
  /** Name of the detector that produced the entity. */
  detector?: string;
  boundingBox?: BoundingBox;
  /** Page number (1-based) for multi-page documents. */
  page?: number;
  /** Non-sensitive metadata only (e.g. `{ validator: "luhn" }`). */
  metadata?: Record<string, unknown>;
}

/** Entity with guaranteed text offsets, used internally by text pipelines. */
export interface SpanEntity extends Entity {
  start: number;
  end: number;
}

/** Public, value-free representation returned in results. */
export interface DetectedEntity {
  id: string;
  type: EntityType;
  start?: number;
  end?: number;
  /** Length of the original value in characters (not the value itself). */
  length?: number;
  confidence: number;
  source: DetectionSource;
  detector?: string;
  boundingBox?: BoundingBox;
  page?: number;
  /** Where the entity was found (`input` or `output`). */
  location?: "input" | "output";
}

export function isSpanEntity(entity: Entity): entity is SpanEntity {
  return typeof entity.start === "number" && typeof entity.end === "number";
}

export function toDetectedEntity(entity: Entity, location?: "input" | "output"): DetectedEntity {
  const out: DetectedEntity = {
    id: entity.id,
    type: entity.type,
    confidence: round(entity.confidence),
    source: entity.source,
  };
  if (entity.start !== undefined) out.start = entity.start;
  if (entity.end !== undefined) out.end = entity.end;
  if (entity.start !== undefined && entity.end !== undefined)
    out.length = entity.end - entity.start;
  if (entity.detector !== undefined) out.detector = entity.detector;
  if (entity.boundingBox !== undefined) out.boundingBox = { ...entity.boundingBox };
  if (entity.page !== undefined) out.page = entity.page;
  if (location !== undefined) out.location = location;
  return out;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
