import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { PolicyError } from "../core/errors.js";
import { extensionOf, isDangerousKey } from "../security/validation.js";
import { BUILT_IN_POLICIES } from "./built-in-policies.js";
import {
  OUTPUT_ACTIONS,
  PROTECTION_ACTIONS,
  type EntityRule,
  type OutputActionType,
  type OutputPolicy,
  type Policy,
  type PolicyDefinition,
  type PolicyInput,
  type ProtectionActionType,
  type PurposeRule,
} from "./policy.js";

const ENTITY_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_EXTENDS_DEPTH = 8;

export interface PolicyValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

/** Parse a YAML or JSON policy document. YAML is parsed with the safe core schema. */
export function parsePolicyText(text: string, format: "yaml" | "json" | "auto" = "auto"): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_POLICY_BYTES)
    throw new PolicyError("Policy document is too large.");
  const trimmed = text.trimStart();
  const asJson =
    format === "json" ||
    (format === "auto" && (trimmed.startsWith("{") || trimmed.startsWith("[")));
  try {
    if (asJson) return JSON.parse(text) as unknown;
    return parseYaml(text, {
      schema: "core",
      merge: false,
      maxAliasCount: 50,
      uniqueKeys: true,
      prettyErrors: false,
    }) as unknown;
  } catch (error) {
    throw new PolicyError("Policy document could not be parsed.", { cause: error });
  }
}

/** Load a policy definition from a .yaml/.yml/.json file. */
export async function loadPolicyFile(
  path: string,
  knownEntityTypes?: ReadonlySet<string>,
): Promise<Policy> {
  const ext = extensionOf(path);
  if (!["yaml", "yml", "json"].includes(ext)) {
    throw new PolicyError("Policy files must have a .yaml, .yml or .json extension.");
  }
  const text = await readFile(path, "utf8");
  return resolvePolicy(
    parsePolicyText(text, ext === "json" ? "json" : "yaml") as PolicyInput,
    knownEntityTypes,
  );
}

/** Validate a policy definition without resolving it. Returns all issues found. */
export function validatePolicyDefinition(
  raw: unknown,
  knownEntityTypes?: ReadonlySet<string>,
): PolicyValidationIssue[] {
  const issues: PolicyValidationIssue[] = [];
  const err = (path: string, message: string): void =>
    void issues.push({ path, message, severity: "error" });
  const warn = (path: string, message: string): void =>
    void issues.push({ path, message, severity: "warning" });

  if (!isPlainObject(raw)) {
    err("$", "Policy must be an object.");
    return issues;
  }
  const def = isShorthand(raw) ? { entities: raw } : raw;
  const allowed = new Set([
    "name",
    "extends",
    "version",
    "description",
    "defaultAction",
    "minConfidence",
    "failMode",
    "entities",
    "output",
    "purposes",
  ]);
  for (const key of Object.keys(def)) {
    if (isDangerousKey(key)) err(key, "Forbidden key.");
    else if (!allowed.has(key)) warn(key, "Unknown policy field is ignored.");
  }
  if (
    def.name !== undefined &&
    (typeof def.name !== "string" || !/^[\w.-]{1,64}$/.test(def.name))
  ) {
    err("name", "Policy name must be 1-64 characters of letters, digits, '.', '_' or '-'.");
  }
  if (
    def.extends !== undefined &&
    (typeof def.extends !== "string" || !(def.extends in BUILT_IN_POLICIES))
  ) {
    err(
      "extends",
      `"extends" must name a built-in policy (${Object.keys(BUILT_IN_POLICIES).join(", ")}).`,
    );
  }
  if (def.defaultAction !== undefined && !isAction(def.defaultAction))
    err("defaultAction", "Invalid action.");
  if (def.minConfidence !== undefined && !isUnit(def.minConfidence))
    err("minConfidence", "Must be a number between 0 and 1.");
  if (def.failMode !== undefined && def.failMode !== "open" && def.failMode !== "closed")
    err("failMode", 'Must be "open" or "closed".');

  if (def.entities !== undefined) {
    if (!isPlainObject(def.entities)) err("entities", "Must be an object keyed by entity type.");
    else {
      for (const [type, rule] of Object.entries(def.entities)) {
        const path = `entities.${type}`;
        if (!ENTITY_NAME_RE.test(type)) {
          err(path, "Entity type names must be UPPER_SNAKE_CASE.");
          continue;
        }
        if (knownEntityTypes && !knownEntityTypes.has(type))
          warn(path, "Not a built-in or registered entity type.");
        if (typeof rule === "string") {
          if (!isAction(rule)) err(path, `Invalid action "${String(rule).slice(0, 32)}".`);
        } else if (isPlainObject(rule)) {
          if (!isAction(rule.action)) err(`${path}.action`, "Invalid or missing action.");
          if (rule.minConfidence !== undefined && !isUnit(rule.minConfidence))
            err(`${path}.minConfidence`, "Must be between 0 and 1.");
          if (rule.restore !== undefined && typeof rule.restore !== "boolean")
            err(`${path}.restore`, "Must be a boolean.");
          for (const k of Object.keys(rule))
            if (!["action", "minConfidence", "restore"].includes(k))
              warn(`${path}.${k}`, "Unknown field is ignored.");
        } else err(path, "Rule must be an action string or an object with an action.");
      }
    }
  }

  if (def.output !== undefined) {
    if (!isPlainObject(def.output)) err("output", "Must be an object.");
    else {
      if (def.output.restoreTokens !== undefined && typeof def.output.restoreTokens !== "boolean")
        err("output.restoreTokens", "Must be a boolean.");
      if (
        def.output.unexpectedEntityAction !== undefined &&
        !isOutputAction(def.output.unexpectedEntityAction)
      ) {
        err("output.unexpectedEntityAction", `Must be one of ${OUTPUT_ACTIONS.join(", ")}.`);
      }
      if (def.output.entities !== undefined) {
        if (!isPlainObject(def.output.entities)) err("output.entities", "Must be an object.");
        else
          for (const [type, action] of Object.entries(def.output.entities)) {
            if (!ENTITY_NAME_RE.test(type))
              err(`output.entities.${type}`, "Invalid entity type name.");
            else if (!isOutputAction(action))
              err(`output.entities.${type}`, "Invalid output action.");
          }
      }
    }
  }

  if (def.purposes !== undefined) {
    if (!Array.isArray(def.purposes)) err("purposes", "Must be an array.");
    else
      def.purposes.forEach((p: unknown, i: number) => {
        const path = `purposes[${i}]`;
        if (!isPlainObject(p)) return err(path, "Must be an object.");
        if (typeof p.id !== "string" || p.id.length === 0 || p.id.length > 64)
          err(`${path}.id`, "Required string (max 64 chars).");
        if (
          p.keywords !== undefined &&
          (!Array.isArray(p.keywords) ||
            !p.keywords.every((k) => typeof k === "string" && k.length > 0))
        ) {
          err(`${path}.keywords`, "Must be an array of non-empty strings.");
        }
        if (!isPlainObject(p.entities))
          err(`${path}.entities`, "Required object of entity actions.");
        else
          for (const [type, action] of Object.entries(p.entities)) {
            if (!ENTITY_NAME_RE.test(type))
              err(`${path}.entities.${type}`, "Invalid entity type name.");
            else if (!isAction(action)) err(`${path}.entities.${type}`, "Invalid action.");
          }
      });
  }
  return issues;
}

/**
 * Resolve a policy name, definition or shorthand into a complete Policy.
 * Definitions inherit missing fields from `extends` (default: "default").
 */
export function resolvePolicy(
  input: PolicyInput | Policy | undefined,
  knownEntityTypes?: ReadonlySet<string>,
  depth = 0,
): Policy {
  if (depth > MAX_EXTENDS_DEPTH) throw new PolicyError("Policy inheritance is too deep.");
  if (input === undefined) return clonePolicy(BUILT_IN_POLICIES.default!);
  if (typeof input === "string") {
    const builtIn = BUILT_IN_POLICIES[input];
    if (!builtIn) {
      throw new PolicyError(
        `Unknown policy "${input.slice(0, 64)}". Built-in policies: ${Object.keys(BUILT_IN_POLICIES).join(", ")}.`,
      );
    }
    return clonePolicy(builtIn);
  }

  const issues = validatePolicyDefinition(input, knownEntityTypes);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new PolicyError(
      `Invalid policy: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
      {
        details: { errors: errors.map((e) => e.path) },
      },
    );
  }

  const def: PolicyDefinition = isShorthand(input)
    ? { entities: input as NonNullable<PolicyDefinition["entities"]> }
    : (input as PolicyDefinition);
  const base = resolvePolicy(def.extends ?? "default", knownEntityTypes, depth + 1);

  const entities: Policy["entities"] = Object.create(null) as Policy["entities"];
  for (const [type, rule] of Object.entries(base.entities)) if (rule) entities[type] = { ...rule };
  for (const [type, rule] of Object.entries(def.entities ?? {})) {
    if (rule === undefined) continue;
    entities[type] = normalizeRule(rule);
  }

  const output: OutputPolicy = {
    restoreTokens: def.output?.restoreTokens ?? base.output.restoreTokens,
    unexpectedEntityAction: def.output?.unexpectedEntityAction
      ? lc(def.output.unexpectedEntityAction)
      : base.output.unexpectedEntityAction,
    entities: {
      ...(base.output.entities ?? {}),
      ...copyMap<OutputActionType>(def.output?.entities),
    },
  };

  const purposes: PurposeRule[] = def.purposes
    ? def.purposes.map((p) => ({
        id: p.id,
        ...(p.description !== undefined ? { description: p.description } : {}),
        keywords: [...(p.keywords ?? [])],
        entities: copyMap<ProtectionActionType>(p.entities),
      }))
    : base.purposes.map((p) => ({
        ...p,
        keywords: [...(p.keywords ?? [])],
        entities: { ...p.entities },
      }));

  return {
    name: def.name ?? (isShorthand(input) ? "custom" : `${base.name}-custom`),
    ...(def.version !== undefined ? { version: def.version } : {}),
    ...(def.description !== undefined ? { description: def.description } : {}),
    defaultAction: def.defaultAction ? lc(def.defaultAction) : base.defaultAction,
    minConfidence: def.minConfidence ?? base.minConfidence,
    failMode: def.failMode ?? base.failMode,
    entities: { ...entities },
    output,
    purposes,
  };
}

function normalizeRule(rule: EntityRule | ProtectionActionType): EntityRule {
  if (typeof rule === "string") return { action: lc(rule) };
  const out: EntityRule = { action: lc(rule.action) };
  if (rule.minConfidence !== undefined) out.minConfidence = rule.minConfidence;
  if (rule.restore !== undefined) out.restore = rule.restore;
  return out;
}

function copyMap<T>(map: Partial<Record<string, T>> | undefined): Partial<Record<string, T>> {
  const out: Partial<Record<string, T>> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) {
    if (!isDangerousKey(k) && v !== undefined)
      out[k] = (typeof v === "string" ? v.toLowerCase() : v) as T;
  }
  return out;
}

export function clonePolicy(policy: Policy): Policy {
  return structuredClone(policy);
}

/** A shorthand policy is a flat map of UPPER_CASE entity types to action strings. */
function isShorthand(raw: object): boolean {
  const entries = Object.entries(raw);
  return (
    entries.length > 0 && entries.every(([k, v]) => ENTITY_NAME_RE.test(k) && typeof v === "string")
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

// Actions are case-insensitive in policy documents ("REDACT" and "redact" are equivalent).
function isAction(v: unknown): v is ProtectionActionType {
  return (
    typeof v === "string" && (PROTECTION_ACTIONS as readonly string[]).includes(v.toLowerCase())
  );
}

function isOutputAction(v: unknown): v is OutputActionType {
  return typeof v === "string" && (OUTPUT_ACTIONS as readonly string[]).includes(v.toLowerCase());
}

function lc<T extends string>(v: T): T {
  return v.toLowerCase() as T;
}

function isUnit(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}
