import { describe, expect, it } from "vitest";
import { Session, SessionManager } from "../../src/core/context.js";
import { Pseudonymizer } from "../../src/protection/pseudonymizer.js";
import { applyReplacements } from "../../src/protection/redactor.js";
import {
  normalizeValue,
  redactionMarker,
  renderToken,
  Tokenizer,
} from "../../src/protection/tokenizer.js";
import { MemoryMappingStore } from "../../src/restoration/mapping-store.js";
import { Restorer } from "../../src/restoration/restorer.js";

const TTL = 60_000;

describe("tokenizer", () => {
  it("renders value-free tokens", () => {
    expect(renderToken("PERSON", 1)).toBe("[PERSON_001]");
    expect(renderToken("PERSON", 1234)).toBe("[PERSON_1234]");
    expect(redactionMarker("EMAIL")).toBe("[EMAIL_REDACTED]");
  });

  it("is deterministic within a session and normalises equivalent values", async () => {
    const store = new MemoryMappingStore();
    const t = new Tokenizer(store, TTL);
    const s = new Session(TTL);
    const a = await t.tokenize(s, "PHONE", "+91 98765 43210", true);
    const b = await t.tokenize(s, "PHONE", "9876543210", true);
    const c = await t.tokenize(s, "EMAIL", "A@Example.com", true);
    const d = await t.tokenize(s, "EMAIL", "a@example.com", true);
    const e = await t.tokenize(s, "EMAIL", "b@example.com", true);
    expect(a.token).toBe("[PHONE_001]");
    expect(b.token).toBe(a.token);
    expect(c.token).toBe("[EMAIL_001]");
    expect(d.token).toBe(c.token);
    expect(e.token).toBe("[EMAIL_002]");
  });

  it("keeps sessions isolated", async () => {
    const store = new MemoryMappingStore();
    const t = new Tokenizer(store, TTL);
    const s1 = new Session(TTL);
    const s2 = new Session(TTL);
    await t.tokenize(s1, "PERSON", "Alice Example", true);
    await t.tokenize(s2, "PERSON", "Bob Example", true);
    const restorer = new Restorer(store);
    expect((await restorer.restore("[PERSON_001]", s1)).text).toBe("Alice Example");
    expect((await restorer.restore("[PERSON_001]", s2)).text).toBe("Bob Example");
  });

  it("skips token numbers already present in input (collision avoidance)", async () => {
    const t = new Tokenizer(new MemoryMappingStore(), TTL);
    const s = new Session(TTL);
    s.reserve("[PERSON_001]");
    const r = await t.tokenize(s, "PERSON", "Ravi Kumar", true);
    expect(r.token).toBe("[PERSON_002]");
    expect(r.collisionAvoided).toBe(true);
  });

  it("normalises values per type", () => {
    expect(normalizeValue("IBAN", "de89 3704 0044")).toBe("DE8937040044");
    expect(normalizeValue("PERSON", "  John   SMITH ")).toBe("john smith");
  });
});

describe("restorer", () => {
  async function setup() {
    const store = new MemoryMappingStore();
    const t = new Tokenizer(store, TTL);
    const s = new Session(TTL);
    await t.tokenize(s, "PERSON", "Ravi Kumar", true);
    await t.tokenize(s, "EMAIL", "ravi@example.com", false);
    await t.tokenize(s, "MEDICAL_RECORD_NUMBER", "MRN-1", true);
    return { store, s, restorer: new Restorer(store) };
  }

  it("restores tokens including common model rewrites", async () => {
    const { s, restorer } = await setup();
    const out = await restorer.restore(
      "Hi [PERSON_001], PERSON_001, [person_001], [PERSON 001] and [MEDICAL_RECORD_NUMBER_001]!",
      s,
    );
    expect(out.text).toBe("Hi Ravi Kumar, Ravi Kumar, Ravi Kumar, Ravi Kumar and MRN-1!");
    expect(out.restored).toBe(5);
  });

  it("leaves non-restorable and unknown tokens in place with warnings", async () => {
    const { s, restorer } = await setup();
    const out = await restorer.restore("[EMAIL_001] [PHONE_009] Room 101", s);
    expect(out.text).toBe("[EMAIL_001] [PHONE_009] Room 101");
    expect(out.unrestored).toBe(2);
    expect(out.warnings.map((w) => w.code).sort()).toEqual([
      "TOKEN_NOT_RESTORABLE",
      "UNKNOWN_TOKEN",
    ]);
  });

  it("does not consume unrelated brackets", async () => {
    const { s, restorer } = await setup();
    expect((await restorer.restore("[note: PERSON_001]", s)).text).toBe("[note: Ravi Kumar]");
  });

  it("restores pseudonyms", async () => {
    const store = new MemoryMappingStore();
    const s = new Session(TTL);
    const p = new Pseudonymizer(store, TTL);
    const fake = await p.pseudonymize(s, "PERSON", "Ravi Kumar", true);
    const fakeEmail = await p.pseudonymize(s, "EMAIL", "ravi@example.com", true);
    expect(fake).not.toContain("Ravi");
    expect(fake.split(" ")).toHaveLength(2);
    expect(fakeEmail).toMatch(/@example\.com$/);
    expect(await p.pseudonymize(s, "PERSON", "ravi kumar", true)).toBe(fake);
    const out = await new Restorer(store).restore(`Dear ${fake}, we wrote to ${fakeEmail}.`, s);
    expect(out.text).toBe("Dear Ravi Kumar, we wrote to ravi@example.com.");
  });
});

describe("sessions", () => {
  it("destroys mappings with the session", async () => {
    const store = new MemoryMappingStore();
    const manager = new SessionManager(store, TTL);
    const s = manager.create();
    await new Tokenizer(store, TTL).tokenize(s, "PERSON", "Ravi Kumar", true);
    expect(store.size).toBe(1);
    expect(await manager.destroy(s.id)).toBe(true);
    expect(store.size).toBe(0);
    expect(manager.get(s.id)).toBeUndefined();
    expect(() => s.fingerprint("PERSON", "x")).toThrow();
  });

  it("expires sessions after their TTL", async () => {
    const manager = new SessionManager(new MemoryMappingStore(), 1);
    const s = manager.create();
    await new Promise((r) => setTimeout(r, 5));
    expect(manager.get(s.id)).toBeUndefined();
  });

  it("expires stored mappings", async () => {
    const store = new MemoryMappingStore();
    await store.set("k", {
      entityType: "PERSON",
      value: "x",
      restorable: true,
      createdAt: 0,
      expiresAt: Date.now() - 1,
    });
    expect(await store.get("k")).toBeUndefined();
  });
});

describe("applyReplacements", () => {
  it("applies non-overlapping replacements in one pass", () => {
    expect(
      applyReplacements("abcdef", [
        { start: 4, end: 6, replacement: "Y" },
        { start: 0, end: 2, replacement: "X" },
      ]),
    ).toBe("XcdY");
    expect(
      applyReplacements("abcdef", [
        { start: 0, end: 4, replacement: "X" },
        { start: 2, end: 5, replacement: "Z" },
      ]),
    ).toBe("Xef");
  });
});
