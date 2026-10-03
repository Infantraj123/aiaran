import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EntityRegistry } from "../../src/entities/entity-registry.js";
import type { SpanEntity } from "../../src/entities/entity.js";
import { BUILT_IN_POLICIES, BUILT_IN_POLICY_NAMES } from "../../src/policy/built-in-policies.js";
import { PolicyEngine } from "../../src/policy/policy-engine.js";
import {
  loadPolicyFile,
  parsePolicyText,
  resolvePolicy,
  validatePolicyDefinition,
} from "../../src/policy/policy-loader.js";
import { PolicyError } from "../../src/core/errors.js";

const registry = new EntityRegistry();
const e = (type: string, confidence = 0.9): SpanEntity => ({
  id: "",
  type,
  start: 0,
  end: 1,
  confidence,
  source: "regex",
});

describe("built-in policies", () => {
  it("includes all required policies", () => {
    expect(BUILT_IN_POLICY_NAMES).toEqual([
      "default",
      "strict",
      "healthcare",
      "financial",
      "developer",
      "enterprise",
    ]);
  });

  it("strict, healthcare, financial and enterprise policies fail closed", () => {
    for (const name of ["strict", "healthcare", "financial", "enterprise"])
      expect(BUILT_IN_POLICIES[name]!.failMode).toBe("closed");
  });

  it("matches the documented healthcare actions", () => {
    const p = BUILT_IN_POLICIES.healthcare!;
    expect(p.entities.PERSON?.action).toBe("tokenize");
    expect(p.entities.EMAIL?.action).toBe("redact");
    expect(p.entities.PHONE?.action).toBe("redact");
    expect(p.entities.PATIENT_ID?.action).toBe("tokenize");
    expect(p.entities.CREDIT_CARD?.action).toBe("block");
    expect(p.entities.PASSWORD?.action).toBe("block");
  });

  it("returns copies so built-ins cannot be mutated through resolvePolicy", () => {
    const p = resolvePolicy("default");
    p.entities.EMAIL = { action: "allow" };
    expect(resolvePolicy("default").entities.EMAIL?.action).toBe("tokenize");
  });
});

describe("policy loading and validation", () => {
  it("resolves the shorthand form on top of the default policy", () => {
    const p = resolvePolicy({ PERSON: "tokenize", EMAIL: "redact", MEDICAL_DATA: "allow" });
    expect(p.name).toBe("custom");
    expect(p.entities.EMAIL?.action).toBe("redact");
    expect(p.entities.MEDICAL_DATA?.action).toBe("allow");
    expect(p.entities.PHONE?.action).toBe("tokenize"); // inherited
  });

  it("parses YAML with extends, case-insensitive actions and purposes", () => {
    const raw = parsePolicyText(`
name: clinic
extends: healthcare
entities:
  EMAIL: REDACT
  PHONE:
    action: Tokenize
    minConfidence: 0.8
purposes:
  - id: research
    keywords: [cohort]
    entities: { PERSON: redact }
`);
    const p = resolvePolicy(raw as never);
    expect(p.name).toBe("clinic");
    expect(p.failMode).toBe("closed");
    expect(p.entities.EMAIL?.action).toBe("redact");
    expect(p.entities.PHONE).toEqual({ action: "tokenize", minConfidence: 0.8 });
    expect(p.purposes.map((x) => x.id)).toEqual(["research"]);
  });

  it("parses JSON policies", () => {
    const p = resolvePolicy(parsePolicyText('{"name":"j","entities":{"EMAIL":"allow"}}') as never);
    expect(p.entities.EMAIL?.action).toBe("allow");
  });

  it("reports all validation errors", () => {
    const issues = validatePolicyDefinition({
      name: "bad name!",
      extends: "nope",
      defaultAction: "explode",
      minConfidence: 2,
      failMode: "sideways",
      entities: { lower: "redact", PERSON: { action: "x" } },
      output: { unexpectedEntityAction: "zap" },
      purposes: [{ id: "", entities: {} }],
    });
    const paths = issues.filter((i) => i.severity === "error").map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "name",
        "extends",
        "defaultAction",
        "minConfidence",
        "failMode",
        "entities.lower",
        "entities.PERSON.action",
        "output.unexpectedEntityAction",
        "purposes[0].id",
      ]),
    );
  });

  it("warns about unknown entity types when a registry is provided", () => {
    const issues = validatePolicyDefinition(
      { entities: { EMPLOYEE_ID: "redact" } },
      new Set(["EMAIL"]),
    );
    expect(issues).toEqual([
      expect.objectContaining({ severity: "warning", path: "entities.EMPLOYEE_ID" }),
    ]);
  });

  it("throws PolicyError for invalid policies and unknown names", () => {
    expect(() => resolvePolicy("nope")).toThrow(PolicyError);
    expect(() => resolvePolicy({ entities: { EMAIL: "explode" as never } })).toThrow(PolicyError);
  });

  it("rejects YAML anchors abuse and unparsable input", () => {
    const bomb =
      `a: &a ["x","x","x","x","x","x","x","x","x"]\n` +
      Array.from({ length: 60 }, (_, i) => `k${i}: *a`).join("\n");
    expect(() => parsePolicyText(bomb)).toThrow(PolicyError);
    expect(() => parsePolicyText("{not json")).toThrow(PolicyError);
  });

  it("loads policies from files and rejects other extensions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aran-policy-"));
    await writeFile(join(dir, "p.yaml"), "name: filepolicy\nentities:\n  EMAIL: allow\n");
    await writeFile(join(dir, "p.txt"), "name: x");
    expect((await loadPolicyFile(join(dir, "p.yaml"))).name).toBe("filepolicy");
    await expect(loadPolicyFile(join(dir, "p.txt"))).rejects.toThrow(PolicyError);
  });
});

describe("PolicyEngine", () => {
  it("applies rules, default action and confidence thresholds", () => {
    const engine = new PolicyEngine(
      resolvePolicy({
        name: "t",
        defaultAction: "redact",
        minConfidence: 0.5,
        entities: { EMAIL: "tokenize", PHONE: { action: "redact", minConfidence: 0.95 } },
      }),
      registry,
    );
    const { decisions, warnings } = engine.decide([
      e("EMAIL"),
      e("PHONE", 0.9),
      e("CUSTOM_THING"),
      e("PERSON", 0.2),
    ]);
    expect(decisions.map((d) => [d.entity.type, d.action, d.reason])).toEqual([
      ["EMAIL", "tokenize", "policy"],
      ["CUSTOM_THING", "redact", "default"],
    ]);
    expect(warnings.map((w) => w.code)).toContain("LOW_CONFIDENCE_ENTITY");
  });

  it("applies purpose rules and explains the minimization decision", () => {
    const engine = new PolicyEngine(resolvePolicy("healthcare"), registry);
    const { minimization, decisions } = engine.decide(
      [e("PERSON"), e("PATIENT_ID"), e("AGE"), e("PHONE")],
      "Analyze cardiovascular risk",
    );
    expect(minimization.matchedRule).toBe("clinical-analysis");
    expect(minimization.removed).toEqual(expect.arrayContaining(["PERSON", "PATIENT_ID", "PHONE"]));
    expect(minimization.retained).toEqual(["AGE"]);
    expect(minimization.blocked).toEqual([]);
    expect(decisions.find((d) => d.entity.type === "PERSON")?.reason).toBe("purpose");
  });

  it("reports unmatched purposes transparently", () => {
    const engine = new PolicyEngine(resolvePolicy("healthcare"), registry);
    const { minimization, warnings } = engine.decide([e("PERSON")], "translate to French");
    expect(minimization.matchedRule).toBeUndefined();
    expect(minimization.reason).toMatch(/No purpose rule matched/);
    expect(warnings.map((w) => w.code)).toContain("PURPOSE_NOT_MATCHED");
  });

  it("marks blocked requests", () => {
    const engine = new PolicyEngine(resolvePolicy("strict"), registry);
    const result = engine.decide([e("PASSWORD")]);
    expect(result.blocked).toBe(true);
    expect(result.minimization.blocked).toEqual(["PASSWORD"]);
  });

  it("respects restore:false and global restoreTokens", () => {
    const engine = new PolicyEngine(
      resolvePolicy({ entities: { EMAIL: { action: "tokenize", restore: false } } }),
      registry,
    );
    expect(engine.actionFor("EMAIL").restorable).toBe(false);
    expect(engine.actionFor("PERSON").restorable).toBe(true);
    const noRestore = new PolicyEngine(
      resolvePolicy({ output: { restoreTokens: false } }),
      registry,
    );
    expect(noRestore.actionFor("PERSON").restorable).toBe(false);
  });

  it("derives output actions with per-entity overrides", () => {
    const engine = new PolicyEngine(resolvePolicy("default"), registry);
    expect(engine.outputActionFor("EMAIL")).toBe("warn");
    expect(engine.outputActionFor("API_KEY")).toBe("redact");
  });
});

describe("purpose matching", () => {
  const engine = new PolicyEngine(resolvePolicy("healthcare"), registry);
  it("prefers exact ids, then the most specific keyword", () => {
    expect(engine.matchPurpose("billing")?.id).toBe("billing");
    expect(engine.matchPurpose("Patient communication: summarise the visit")?.id).toBe(
      "patient-communication",
    );
    expect(engine.matchPurpose("summarise the visit")?.id).toBe("clinical-analysis");
    expect(engine.matchPurpose("translate to French")).toBeUndefined();
  });
});
