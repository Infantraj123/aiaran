import { describe, expect, it } from "vitest";
import { DetectionEngine } from "../../src/detection/engine.js";
import type { Detector } from "../../src/detection/detector.js";
import { guessLanguage, supportsLanguage } from "../../src/detection/detector.js";
import { createPiiDetector } from "../../src/detection/pii-detector.js";
import { createSecretDetector } from "../../src/detection/secret-detector.js";
import { EntityRegistry } from "../../src/entities/entity-registry.js";
import type { SpanEntity } from "../../src/entities/entity.js";

const registry = new EntityRegistry();
const span = (type: string, start: number, end: number, confidence: number): SpanEntity => ({
  id: "",
  type,
  start,
  end,
  confidence,
  source: "regex",
});

describe("DetectionEngine", () => {
  const engine = new DetectionEngine(
    () => [createPiiDetector(), createSecretDetector()],
    registry,
    1000,
  );

  it("resolves overlaps by confidence, priority and length", () => {
    const resolved = engine.resolveOverlaps([
      span("PHONE", 0, 10, 0.7),
      span("AADHAAR", 0, 14, 0.92),
      span("EMAIL", 20, 30, 0.95),
      span("URL", 22, 28, 0.6),
    ]);
    expect(resolved.map((e) => e.type)).toEqual(["AADHAAR", "EMAIL"]);
  });

  it("prefers the longer span on near-ties", () => {
    const resolved = engine.resolveOverlaps([
      span("PERSON", 0, 4, 0.8),
      span("PERSON", 0, 10, 0.79),
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.end).toBe(10);
  });

  it("never re-detects ARAN tokens", async () => {
    const { entities } = await engine.detect({
      text: "Contact [EMAIL_001] or [PHONE_REDACTED] now",
    });
    expect(entities).toEqual([]);
  });

  it("assigns sequential ids and returns ordered, non-overlapping spans", async () => {
    const text = `mail a@example.com phone +91 98765 43210 key ${"AKIA" + "IOSFODNN7EXAMPLE"}`;
    const { entities } = await engine.detect({ text });
    expect(entities.map((e) => e.id)).toEqual(["E1", "E2", "E3"]);
    for (let i = 1; i < entities.length; i++)
      expect(entities[i]!.start).toBeGreaterThanOrEqual(entities[i - 1]!.end);
  });

  it("reports failing detectors as incomplete instead of throwing", async () => {
    const broken: Detector = {
      name: "broken",
      version: "1",
      entityTypes: [],
      detect: () => Promise.reject(new Error("boom")),
    };
    const e = new DetectionEngine(() => [broken, createPiiDetector()], registry, 1000);
    const outcome = await e.detect({ text: "a@example.com" });
    expect(outcome.incomplete).toBe(true);
    expect(outcome.warnings[0]?.code).toBe("DETECTOR_FAILED");
    expect(outcome.entities).toHaveLength(1);
  });

  it("drops invalid spans returned by custom detectors", async () => {
    const bad: Detector = {
      name: "bad",
      version: "1",
      entityTypes: ["X"],
      detect: async () => [
        span("X", -1, 3, 1),
        span("X", 5, 2, 1),
        span("X", 0, 999, 1),
        { id: "", type: "X", confidence: 1, source: "custom" },
      ],
    };
    const e = new DetectionEngine(() => [bad], registry, 1000);
    expect((await e.detect({ text: "hello" })).entities).toEqual([]);
  });

  it("caps the number of entities", async () => {
    const e = new DetectionEngine(() => [createPiiDetector()], registry, 2);
    const outcome = await e.detect({ text: "a@x.io b@x.io c@x.io d@x.io" });
    expect(outcome.entities).toHaveLength(2);
    expect(outcome.incomplete).toBe(true);
  });
});

describe("language helpers", () => {
  it("guesses language by script", () => {
    expect(guessLanguage("Hello world")).toBe("en");
    expect(guessLanguage("मेरा नाम राहुल है")).toBe("hi");
    expect(guessLanguage("என் பெயர் ராஜேஷ்")).toBe("ta");
    expect(guessLanguage("Name: राहुल शर्मा from Delhi")).toBe("mixed");
    expect(guessLanguage("12345")).toBeUndefined();
  });

  it("filters detectors by declared languages", () => {
    const d: Detector = {
      name: "ta-only",
      version: "1",
      entityTypes: [],
      languages: ["ta"],
      detect: async () => [],
    };
    expect(supportsLanguage(d, "ta-IN")).toBe(true);
    expect(supportsLanguage(d, "en")).toBe(false);
    expect(supportsLanguage(d, "mixed")).toBe(true);
    expect(supportsLanguage(d, undefined)).toBe(true);
  });
});
