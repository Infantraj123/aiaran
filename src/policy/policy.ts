import type { EntityType } from "../entities/entity-types.js";

/** Actions applied to sensitive entities in input data. */
export const PROTECTION_ACTIONS = ["allow", "redact", "tokenize", "pseudonymize", "block"] as const;
export type ProtectionActionType = (typeof PROTECTION_ACTIONS)[number];

/** Actions applied to unexpected sensitive entities found in AI output. */
export const OUTPUT_ACTIONS = ["allow", "warn", "redact", "tokenize", "block"] as const;
export type OutputActionType = (typeof OUTPUT_ACTIONS)[number];

export type FailMode = "open" | "closed";

export interface EntityRule {
  action: ProtectionActionType;
  /** Entities below this confidence are ignored. Overrides the policy-wide value. */
  minConfidence?: number;
  /**
   * Whether tokens/pseudonyms for this entity may be restored to the original
   * value when releasing AI output. Defaults to `true` for tokenize/pseudonymize.
   */
  restore?: boolean;
}

/**
 * Purpose-based data minimization rule. When a request's `purpose` matches
 * (by exact `id` or by any keyword, case-insensitively), the listed entity
 * actions override the base policy. Matching is deliberately simple and
 * deterministic so that decisions are explainable.
 */
export interface PurposeRule {
  id: string;
  description?: string;
  keywords?: string[];
  entities: Partial<Record<EntityType, ProtectionActionType>>;
}

export interface OutputPolicy {
  /** Restore tokens in AI output back to original values (when the entity rule allows). */
  restoreTokens: boolean;
  /** Action for sensitive entities in AI output that ARAN did not tokenize. */
  unexpectedEntityAction: OutputActionType;
  /** Per-entity overrides for unexpected output entities. */
  entities?: Partial<Record<EntityType, OutputActionType>>;
}

/** Fully resolved policy used by the engine. */
export interface Policy {
  name: string;
  version?: string;
  description?: string;
  /** Action for detected entity types without an explicit rule. */
  defaultAction: ProtectionActionType;
  minConfidence: number;
  failMode: FailMode;
  entities: Partial<Record<EntityType, EntityRule>>;
  output: OutputPolicy;
  purposes: PurposeRule[];
}

/** User-facing policy definition (JSON/YAML/object). Missing fields come from `extends`. */
export interface PolicyDefinition {
  name?: string;
  extends?: string;
  version?: string;
  description?: string;
  defaultAction?: ProtectionActionType;
  minConfidence?: number;
  failMode?: FailMode;
  entities?: Partial<Record<EntityType, EntityRule | ProtectionActionType>>;
  output?: Partial<OutputPolicy>;
  purposes?: PurposeRule[];
}

/** Shorthand: `{ PERSON: "tokenize", EMAIL: "redact" }` (extends the default policy). */
export type PolicyShorthand = Partial<Record<EntityType, ProtectionActionType>>;

export type PolicyInput = string | PolicyDefinition | PolicyShorthand;
