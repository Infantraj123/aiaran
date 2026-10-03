import type { SpanEntity } from "../entities/entity.js";
import type { EntityRegistry } from "../entities/entity-registry.js";
import type { EntityType } from "../entities/entity-types.js";
import type { MinimizationReport, ProtectionAction, Warning } from "../types/output.js";
import type { OutputActionType, Policy, ProtectionActionType, PurposeRule } from "./policy.js";

export interface EntityDecision {
  entity: SpanEntity;
  action: ProtectionActionType;
  reason: ProtectionAction["reason"];
  restorable: boolean;
}

export interface PolicyDecision {
  decisions: EntityDecision[];
  minimization: MinimizationReport;
  blocked: boolean;
  warnings: Warning[];
}

/**
 * Applies a resolved Policy to detected entities. Decisions are
 * deterministic and explainable: every action records whether it came from
 * the policy, a purpose rule, or the default action.
 */
export class PolicyEngine {
  constructor(
    readonly policy: Policy,
    private readonly registry: EntityRegistry,
    private readonly minConfidenceOverride?: number,
  ) {}

  get minConfidence(): number {
    return this.minConfidenceOverride ?? this.policy.minConfidence;
  }

  /**
   * Match a request purpose to a purpose rule:
   * 1. a rule whose `id` equals the purpose (case-insensitive) wins;
   * 2. otherwise the rule with the longest keyword contained in the purpose
   *    (the most specific match); ties go to the rule listed first.
   */
  matchPurpose(purpose: string | undefined): PurposeRule | undefined {
    if (!purpose) return undefined;
    const normalized = purpose.toLowerCase().trim();
    const exact = this.policy.purposes.find((rule) => rule.id.toLowerCase() === normalized);
    if (exact) return exact;
    let best: PurposeRule | undefined;
    let bestLength = 0;
    for (const rule of this.policy.purposes) {
      for (const keyword of rule.keywords ?? []) {
        const k = keyword.toLowerCase();
        if (k.length > bestLength && normalized.includes(k)) {
          best = rule;
          bestLength = k.length;
        }
      }
    }
    return best;
  }

  actionFor(
    type: EntityType,
    purposeRule?: PurposeRule,
  ): { action: ProtectionActionType; reason: ProtectionAction["reason"]; restorable: boolean } {
    const rule = this.policy.entities[type];
    const purposeAction = purposeRule?.entities[type];
    let action: ProtectionActionType;
    let reason: ProtectionAction["reason"];
    if (purposeAction) {
      action = purposeAction;
      reason = "purpose";
    } else if (rule) {
      action = rule.action;
      reason = "policy";
    } else {
      action = this.registry.get(type)?.defaultAction ?? this.policy.defaultAction;
      reason = "default";
    }
    const reversible = action === "tokenize" || action === "pseudonymize";
    const restorable = reversible && (rule?.restore ?? true) && this.policy.output.restoreTokens;
    return { action, reason, restorable };
  }

  /** Confidence threshold for a type (rule-specific threshold wins). */
  thresholdFor(type: EntityType): number {
    return this.policy.entities[type]?.minConfidence ?? this.minConfidence;
  }

  decide(entities: SpanEntity[], purpose?: string): PolicyDecision {
    const warnings: Warning[] = [];
    const purposeRule = this.matchPurpose(purpose);
    if (purpose && !purposeRule) {
      warnings.push({
        code: "PURPOSE_NOT_MATCHED",
        message:
          "No purpose rule in the active policy matched the request purpose; the base policy was applied.",
        severity: "info",
      });
    }

    const decisions: EntityDecision[] = [];
    let ignored = 0;
    for (const entity of entities) {
      if (entity.confidence < this.thresholdFor(entity.type)) {
        ignored++;
        continue;
      }
      const { action, reason, restorable } = this.actionFor(entity.type, purposeRule);
      decisions.push({ entity, action, reason, restorable });
    }
    if (ignored > 0) {
      warnings.push({
        code: "LOW_CONFIDENCE_ENTITY",
        message: `${ignored} low-confidence candidate(s) were below the policy threshold and left unchanged.`,
        severity: "info",
      });
    }

    const byAction = (actions: ProtectionActionType[]): EntityType[] =>
      unique(decisions.filter((d) => actions.includes(d.action)).map((d) => d.entity.type));

    const minimization: MinimizationReport = {
      ...(purpose !== undefined ? { purpose } : {}),
      ...(purposeRule ? { matchedRule: purposeRule.id } : {}),
      reason: purposeRule
        ? `Purpose matched rule "${purposeRule.id}"${purposeRule.description ? `: ${purposeRule.description}` : ""}`
        : purpose
          ? "No purpose rule matched; base policy applied."
          : "No purpose provided; base policy applied.",
      removed: byAction(["redact"]),
      retained: byAction(["allow"]),
      tokenized: byAction(["tokenize", "pseudonymize"]),
      blocked: byAction(["block"]),
    };

    return { decisions, minimization, blocked: minimization.blocked.length > 0, warnings };
  }

  outputActionFor(type: EntityType): OutputActionType {
    return this.policy.output.entities?.[type] ?? this.policy.output.unexpectedEntityAction;
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
