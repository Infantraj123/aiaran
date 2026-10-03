import { describe, expect, it } from "vitest";
import { Aran, resolvePolicy, PolicyError } from "../../src/index.js";
import { createPiiDetector } from "../../src/detection/pii-detector.js";
import { createSecretDetector } from "../../src/detection/secret-detector.js";
import { HeuristicNerDetector } from "../../src/detection/ner-detector.js";

describe("prototype pollution", () => {
  it("never copies __proto__/constructor keys from structured input", async () => {
    const aran = new Aran({ logger: false });
    const payload = JSON.parse(
      '{"a":"x","__proto__":{"polluted":"yes"},"nested":{"constructor":{"prototype":{"polluted":"yes"}}}}',
    ) as Record<string, unknown>;
    const r = await aran.protect({ type: "text", data: payload });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(r.safeData as object)).toEqual(["a", "nested"]);
    expect(Object.getPrototypeOf(r.safeData)).toBe(Object.prototype);
    expect((r.safeData as { nested: object }).nested).toEqual({});
    await aran.dispose();
  });

  it("rejects prototype keys in policies", () => {
    const evil = JSON.parse('{"entities":{"__proto__":{"action":"allow"}}}') as never;
    expect(() => resolvePolicy(evil)).toThrow(PolicyError);
    expect(({} as Record<string, unknown>).action).toBeUndefined();
  });
});

describe("malformed and adversarial input (ReDoS)", () => {
  const detectors = [createPiiDetector(), createSecretDetector(), new HeuristicNerDetector()];
  const adversarial: [string, string][] = [
    ["long digits", "1".repeat(50_000)],
    ["digit groups", "1234 ".repeat(10_000)],
    ["email-like", "a".repeat(20_000) + "@" + "b.".repeat(5_000)],
    ["capitalised words", "Aaaa ".repeat(10_000)],
    ["street-like", "12 " + "Main ".repeat(5_000) + "Street"],
    ["dots", ".".repeat(50_000)],
    ["colons", "a:".repeat(20_000)],
    ["urls", "http://" + "a".repeat(30_000)],
    ["passwords", "password=".repeat(5_000)],
    ["unicode", "नाम ".repeat(10_000)],
    ["mixed", "Mr. ".repeat(10_000)],
  ];

  it.each(adversarial)("completes quickly on %s", async (_name, text) => {
    for (const d of detectors) {
      const started = performance.now();
      await d.detect({ text });
      expect(performance.now() - started).toBeLessThan(2_000);
    }
  });

  it("handles binary garbage and control characters as text", async () => {
    const aran = new Aran({ logger: false });
    const garbage = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)).toString(
      "latin1",
    );
    const r = await aran.protect({ type: "text", data: `${garbage}\u0000‮ a@example.com` });
    expect(r.safeData).toContain("[EMAIL_001]");
    await aran.dispose();
  });

  it("applies the processing timeout", async () => {
    const aran = new Aran({
      logger: false,
      limits: { timeoutMs: 20 },
      detectors: [
        {
          name: "slow",
          version: "1",
          entityTypes: [],
          detect: () => new Promise((r) => setTimeout(() => r([]), 500)),
        },
      ],
    });
    await expect(aran.protect({ type: "text", data: "x" })).rejects.toThrow(/exceeded/);
    await aran.dispose();
  });
});
