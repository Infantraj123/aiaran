import type { DetectedEntity } from "../entities/entity.js";
import type { EntityRegistry } from "../entities/entity-registry.js";
import type { ProtectionSummary, RiskLevel } from "../types/output.js";

export function summarize(
  entities: readonly DetectedEntity[],
  registry: EntityRegistry,
): ProtectionSummary {
  const counts: Record<string, number> = {};
  for (const e of entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return { total: entities.length, counts, riskLevel: riskLevel(Object.keys(counts), registry) };
}

export function riskLevel(types: readonly string[], registry: EntityRegistry): RiskLevel {
  if (types.length === 0) return "NONE";
  const categories = new Set(types.map((t) => registry.category(t)));
  if (categories.has("security")) return "CRITICAL";
  if (categories.has("government") || categories.has("financial") || categories.has("healthcare"))
    return "HIGH";
  if (categories.has("identity") || categories.has("custom")) return "MEDIUM";
  return "LOW";
}
