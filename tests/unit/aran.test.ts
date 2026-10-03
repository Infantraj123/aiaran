import { afterEach, describe, expect, it } from "vitest";
import {
  Aran,
  BlockedError,
  InputValidationError,
  RestorationError,
  SecurityError,
  createProvider,
  type AuditEvent,
  type Detector,
  type MappingStore,
  type ProtectedValue,
} from "../../src/index.js";
import { S } from "../helpers/synthetic.js";

const instances: Aran[] = [];
function aran(options: ConstructorParameters<typeof Aran>[0] = {}): Aran {
  const a = new Aran({ logger: false, ...options });
  instances.push(a);
  return a;
}
afterEach(async () => {
  await Promise.all(instances.splice(0).map((a) => a.dispose()));
});

describe("Aran.protect — text", () => {
  it("handles the README example", async () => {
    const result = await aran().protect({
      type: "text",
      data: "My name is John and my email is john@example.com",
    });
    expect(result.safeData).toBe("My name is [PERSON_001] and my email is [EMAIL_001]");
    expect(result.protectedData).toBe(result.safeData);
    expect(result.status).toBe("safe");
    expect(result.summary).toEqual({
      total: 2,
      counts: { PERSON: 1, EMAIL: 1 },
      riskLevel: "MEDIUM",
    });
    expect(result.metadata.detectorVersions).toHaveProperty("aran.pii");
    expect(result.policy).toBe("default");
  });

  it("produces the documented healthcare output", async () => {
    const result = await aran({ policy: "healthcare", mode: "strict" }).protect({
      type: "text",
      data: "Patient John Smith,\npatient ID P123456,\nage 52,\nblood pressure 150/95.",
    });
    expect(result.safeData).toBe(
      "Patient [PERSON_001],\npatient ID [PATIENT_ID_001],\nage 52,\nblood pressure 150/95.",
    );
    expect(result.minimization.tokenized).toEqual(["PERSON", "PATIENT_ID"]);
    expect(result.minimization.retained).toEqual(["AGE"]);
  });

  it("applies purpose-based minimization", async () => {
    const result = await aran({ policy: "healthcare" }).protect({
      type: "text",
      data: "Patient John Smith, patient ID P123456, age 52, phone +91 98765 43210, BP 150/95.",
      purpose: "Analyze cardiovascular risk",
    });
    expect(result.safeData).toBe(
      "Patient [PERSON_REDACTED], patient ID [PATIENT_ID_REDACTED], age 52, phone [PHONE_REDACTED], BP 150/95.",
    );
    expect(result.minimization).toMatchObject({
      purpose: "Analyze cardiovascular risk",
      matchedRule: "clinical-analysis",
      retained: ["AGE"],
      blocked: [],
    });
    expect(result.minimization.removed).toEqual(
      expect.arrayContaining(["PERSON", "PATIENT_ID", "PHONE"]),
    );
    expect(result.actions.every((a) => a.reason === "purpose")).toBe(true);
  });

  it("blocks requests and withholds data when policy says block", async () => {
    const result = await aran({ policy: "strict" }).protect({
      type: "text",
      data: `deploy with ${S.awsKey}`,
    });
    expect(result.status).toBe("blocked");
    expect(result.safeData).toBeNull();
    expect(result.minimization.blocked).toEqual(["AWS_ACCESS_KEY"]);
    expect(result.summary.riskLevel).toBe("CRITICAL");
  });

  it("protects structured objects, field hints and numeric fields", async () => {
    const result = await aran().protect({
      type: "text",
      data: {
        name: "Kiran",
        contact: { email: S.email, phone: 9876543210 },
        notes: ["call Ravi Kumar"],
        age: 41,
        active: true,
        nothing: null,
      },
    });
    expect(result.safeData).toEqual({
      name: "[PERSON_001]",
      contact: { email: "[EMAIL_001]", phone: "[PHONE_001]" },
      notes: ["call [PERSON_002]"],
      age: 41,
      active: true,
      nothing: null,
    });
  });

  it("keeps the same token for repeated values and across a reused session", async () => {
    const a = aran();
    const first = await a.protect({ type: "text", data: "Ravi Kumar wrote to Ravi Kumar" });
    expect(first.safeData).toBe("[PERSON_001] wrote to [PERSON_001]");
    const second = await a.protect({
      type: "text",
      data: "Ravi Kumar and Emily Carter",
      sessionId: first.sessionId,
    });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.safeData).toBe("[PERSON_001] and [PERSON_002]");
  });

  it("supports pseudonymization", async () => {
    const result = await aran({ policy: { PERSON: "pseudonymize" } }).protect({
      type: "text",
      data: "Dear Ravi Kumar,",
    });
    expect(result.safeData).not.toContain("Ravi");
    expect(result.safeData).toMatch(/^Dear \w+ \w+,$/);
  });

  it("rejects invalid input", async () => {
    const a = aran();
    await expect(a.protect({ type: "audio" } as never)).rejects.toThrow(InputValidationError);
    await expect(a.protect({ type: "text" } as never)).rejects.toThrow(InputValidationError);
    await expect(a.protect({ type: "text", data: 42 } as never)).rejects.toThrow(
      InputValidationError,
    );
    await expect(a.protect({ type: "text", data: "x", sessionId: "ses_unknown" })).rejects.toThrow(
      InputValidationError,
    );
    await expect(a.protect({ type: "text", data: { d: new Date() } })).rejects.toThrow(
      InputValidationError,
    );
  });

  it("enforces text size and structure limits", async () => {
    const a = aran({ limits: { maxTextBytes: 10, maxObjectDepth: 3 } });
    await expect(a.protect({ type: "text", data: "x".repeat(11) })).rejects.toThrow(SecurityError);
    await expect(
      a.protect({ type: "text", data: { a: { b: { c: { d: { e: "x" } } } } } }),
    ).rejects.toThrow(SecurityError);
  });
});

describe("fail modes", () => {
  const failing: Detector = {
    name: "flaky",
    version: "1",
    entityTypes: [],
    detect: () => Promise.reject(new Error("down")),
  };

  it("returns data with status uncertain in fail-open mode", async () => {
    const result = await aran({ detectors: [failing] }).protect({
      type: "text",
      data: "hello a@example.com",
    });
    expect(result.status).toBe("uncertain");
    expect(result.safeData).toBe("hello [EMAIL_001]");
  });

  it("withholds data in fail-closed mode", async () => {
    const result = await aran({ detectors: [failing], failMode: "closed" }).protect({
      type: "text",
      data: "hello",
    });
    expect(result.status).toBe("uncertain");
    expect(result.safeData).toBeNull();
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["DETECTOR_FAILED", "FAIL_CLOSED_WITHHELD"]),
    );
  });

  it("strict mode forces fail-closed", () => {
    expect(aran({ mode: "strict" }).failMode).toBe("closed");
    expect(aran().failMode).toBe("open");
  });
});

describe("release and restore", () => {
  it("restores tokens and scans for unexpected sensitive output", async () => {
    const a = aran();
    const p = await a.protect({
      type: "text",
      data: "My name is John and my email is john@example.com",
    });
    const r = await a.release(
      "Hello [PERSON_001]! I emailed [EMAIL_001] and cc'd jane.roe@example.org.",
      p.sessionId,
    );
    expect(r.data).toBe("Hello John! I emailed john@example.com and cc'd jane.roe@example.org.");
    expect(r.status).toBe("warned");
    expect(r.restoredTokens).toBe(2);
    expect(r.detectedEntities).toEqual([
      expect.objectContaining({ type: "EMAIL", location: "output" }),
    ]);
  });

  it("redacts or blocks unexpected output per policy", async () => {
    const a = aran({ policy: "healthcare" });
    const p = await a.protect({ type: "text", data: "Patient John Smith" });
    const redacted = await a.release(
      "[PERSON_001] lives at 12 MG Road, Chennai - 600001.",
      p.sessionId,
    );
    expect(redacted.data).toBe("John Smith lives at [ADDRESS_REDACTED].");
    const blocking = aran({ policy: { output: { entities: { CREDIT_CARD: "block" } } } as never });
    const p2 = await blocking.protect({ type: "text", data: "hi" });
    const blocked = await blocking.release(`Your card ${S.card}`, p2.sessionId);
    expect(blocked.status).toBe("blocked");
    expect(blocked.data).toBeNull();
    await expect(blocking.restore(`Your card ${S.card}`, p2.sessionId)).rejects.toThrow(
      BlockedError,
    );
  });

  it("does not treat values allowed by policy as leaks", async () => {
    const a = aran();
    const p = await a.protect({ type: "text", data: "age 52" });
    const r = await a.release("At age 52 see https://example.com/guide", p.sessionId);
    expect(r.status).toBe("safe");
    expect(r.detectedEntities).toEqual([]);
  });

  it("restore() returns text and fails clearly without a session", async () => {
    const a = aran();
    const p = await a.protect({ type: "text", data: "Ravi Kumar" });
    expect(await a.restore("Hi [PERSON_001]", p.sessionId)).toBe("Hi Ravi Kumar");
    await expect(a.restore("Hi [PERSON_001]", "ses_missing")).rejects.toThrow(RestorationError);
    const noSession = await a.release("Hi [PERSON_001]");
    expect(noSession.data).toBe("Hi [PERSON_001]");
    expect(noSession.warnings.map((w) => w.code)).toContain("NO_SESSION");
  });

  it("zero-retention destroys mappings after release", async () => {
    const a = aran({ retention: "zero" });
    const p = await a.protect({ type: "text", data: "Ravi Kumar" });
    expect((await a.release("[PERSON_001]", p.sessionId)).data).toBe("Ravi Kumar");
    expect(a.activeSessions).toBe(0);
    expect((await a.release("[PERSON_001]", p.sessionId)).data).toBe("[PERSON_001]");
  });

  it("destroySession removes mappings", async () => {
    const a = aran();
    const p = await a.protect({ type: "text", data: "Ravi Kumar" });
    expect(await a.destroySession(p.sessionId)).toBe(true);
    expect(await a.destroySession(p.sessionId)).toBe(false);
    expect((await a.release("[PERSON_001]", p.sessionId)).data).toBe("[PERSON_001]");
  });

  it("works with the encrypted-memory store and custom stores", async () => {
    const enc = aran({ mappingStore: "encrypted-memory" });
    const p = await enc.protect({ type: "text", data: "Ravi Kumar" });
    expect(await enc.restore("[PERSON_001]", p.sessionId)).toBe("Ravi Kumar");

    const saved = new Map<string, ProtectedValue>();
    const custom: MappingStore = {
      set: async (k, v) => void saved.set(k, v),
      get: async (k) => saved.get(k),
      delete: async (k) => void saved.delete(k),
      clear: async () => saved.clear(),
    };
    const persisted = aran({ mappingStore: custom, encryptionKey: Buffer.alloc(32, 7) });
    const p2 = await persisted.protect({ type: "text", data: "Ravi Kumar" });
    expect([...saved.values()].every((v) => v.encrypted && !v.value.includes("Ravi"))).toBe(true);
    expect(await persisted.restore("[PERSON_001]", p2.sessionId)).toBe("Ravi Kumar");
  });
});

describe("extensibility", () => {
  it("registers custom entity types with regex detectors", async () => {
    const a = aran({ policy: { EMPLOYEE_ID: "tokenize" } });
    a.entities.register({ name: "EMPLOYEE_ID", detector: /\bEMP-\d{5}\b/ });
    const r = await a.protect({ type: "text", data: "Badge EMP-00042 issued" });
    expect(r.safeData).toBe("Badge [EMPLOYEE_ID_001] issued");
  });

  it("registers detectors with context keywords and function detectors", async () => {
    const a = aran();
    a.entities.register({
      name: "CASE_NUMBER",
      defaultAction: "redact",
      detector: {
        pattern: /\b\d{6}\b/,
        context: { keywords: ["case"], required: true, windowBefore: 8 },
      },
    });
    a.entities.register({
      name: "PROJECT_CODE",
      detector: ({ text }) => {
        const i = text.indexOf("Project Falcon");
        return i < 0
          ? []
          : [
              {
                id: "",
                type: "PROJECT_CODE",
                start: i,
                end: i + 14,
                confidence: 0.99,
                source: "custom",
              },
            ];
      },
    });
    const r = await a.protect({
      type: "text",
      data: "case 123456 for Project Falcon, invoice 654321",
    });
    expect(r.safeData).toBe(
      "case [CASE_NUMBER_REDACTED] for [PROJECT_CODE_REDACTED], invoice 654321",
    );
  });

  it("rejects invalid custom entity names and empty-matching patterns", () => {
    const a = aran();
    expect(() => a.entities.register({ name: "bad name", detector: /x/ })).toThrow();
    expect(() => a.entities.register({ name: "EMPTY", detector: /x*/ })).toThrow();
  });

  it("can disable built-in detectors", async () => {
    const r = await aran({ disableDetectors: ["aran.ner-heuristic"] }).protect({
      type: "text",
      data: "Mr. Ravi Kumar",
    });
    expect(r.safeData).toBe("Mr. Ravi Kumar");
  });

  it("emits value-free audit events", async () => {
    const events: AuditEvent[] = [];
    const a = aran({ audit: (e) => void events.push(e) });
    const p = await a.protect({ type: "text", data: `email ${S.email}` });
    await a.release("ok [EMAIL_001]", p.sessionId);
    expect(events.map((e) => e.event)).toEqual([
      "SESSION_CREATED",
      "ENTITY_PROTECTED",
      "REQUEST_PROTECTED",
      "TOKENS_RESTORED",
    ]);
    expect(events[1]).toMatchObject({ entityType: "EMAIL", action: "TOKENIZE" });
    expect(JSON.stringify(events)).not.toContain(S.email);
  });
});

describe("generate()", () => {
  it("sends only safe data and restores the response", async () => {
    const seen: string[] = [];
    const provider = createProvider("mock", async (req) => {
      seen.push(JSON.stringify(req));
      return "Summary for [PERSON_001]: follow up by email.";
    });
    const a = aran();
    const result = await a.generate(
      provider,
      { type: "text", data: "Patient Ravi Kumar, email ravi.kumar@example.com" },
      { system: "Summarize." },
    );
    expect(result.text).toBe("Summary for Ravi Kumar: follow up by email.");
    expect(seen[0]).not.toContain("Ravi");
    expect(seen[0]).not.toContain("ravi.kumar@example.com");
    expect(seen[0]).toContain("placeholders");
    expect(result.response.provider).toBe("mock");
  });

  it("never calls the provider for blocked or fail-closed requests", async () => {
    let calls = 0;
    const provider = createProvider("mock", async () => {
      calls++;
      return "x";
    });
    await expect(
      aran({ policy: "strict" }).generate(provider, { type: "text", data: S.githubToken }),
    ).rejects.toThrow(BlockedError);
    const failing: Detector = {
      name: "f",
      version: "1",
      entityTypes: [],
      detect: () => Promise.reject(new Error("x")),
    };
    await expect(
      aran({ detectors: [failing], failMode: "closed" }).generate(provider, {
        type: "text",
        data: "hi",
      }),
    ).rejects.toThrow(SecurityError);
    expect(calls).toBe(0);
  });

  it("refuses to work after dispose", async () => {
    const a = new Aran({ logger: false });
    await a.dispose();
    await expect(a.protect({ type: "text", data: "x" })).rejects.toThrow(/disposed/);
  });
});
