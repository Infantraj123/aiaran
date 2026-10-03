/**
 * Executes the key code snippets from docs/guide so the documentation stays correct.
 */
import { afterAll, describe, expect, it } from "vitest";
import { Aran, createProvider, type AIRequest } from "../../src/index.js";
import { makeImage } from "../../scripts/fixtures.mjs";

const instances: Aran[] = [];
const make = (o: ConstructorParameters<typeof Aran>[0] = {}): Aran => {
  const a = new Aran({ logger: false, ...o });
  instances.push(a);
  return a;
};
afterAll(() => Promise.all(instances.map((a) => a.dispose())));

describe("guide chapter 3 — text", () => {
  it("chat loop keeps tokenized history and restores replies", async () => {
    const aran = make();
    const history: { role: "user" | "assistant"; content: string }[] = [];
    let sessionId: string | undefined;
    const callYourModel = async (h: typeof history): Promise<string> =>
      `Noted, ${/\[PERSON_\d{3}\]/.exec(h.at(-1)!.content)?.[0] ?? "friend"}.`;
    async function chat(userText: string): Promise<string> {
      const p = await aran.protect({
        type: "text",
        data: userText,
        ...(sessionId ? { sessionId } : {}),
      });
      if (p.safeData === null) throw new Error(`Blocked or not inspectable: ${p.status}`);
      sessionId = p.sessionId;
      history.push({ role: "user", content: p.safeData as string });
      const modelReply = await callYourModel(history);
      history.push({ role: "assistant", content: modelReply });
      return aran.restore(modelReply, sessionId);
    }
    expect(await chat("Hi, I'm Ravi Kumar")).toBe("Noted, Ravi Kumar.");
    expect(await chat("Ravi Kumar again")).toBe("Noted, Ravi Kumar.");
    expect(history.map((h) => h.content).join(" ")).not.toContain("Ravi");
  });

  it("developer policy snippet", async () => {
    const r = await make({ policy: "developer" }).protect({
      type: "text",
      data: `const client = new Client({ apiKey: "sk-proj-Q7tR2vX9mK4pL8nB3cZ6wY1aE5dF0gH" });
db = connect("postgres://admin:S3cr3tPassw0rd@db.internal.example:5432/patients")
2026-10-03T10:00:00Z ERROR auth failed for user=ravi_k ip=10.20.30.40
    at handler (/srv/app/auth.ts:42:13)`,
    });
    const out = r.safeData as string;
    expect(out).toContain("[API_KEY_REDACTED]");
    expect(out).toContain("[DATABASE_URL_REDACTED]");
    expect(out).toContain("ip=[IP_ADDRESS_001]");
    expect(out).toContain("at handler (/srv/app/auth.ts:42:13)");
  });
});

describe("guide chapter 7 — policies", () => {
  it("shorthand pseudonymize/allow", async () => {
    const r = await make({
      policy: { PERSON: "pseudonymize", PHONE: "allow", PASSWORD: "block" },
    }).protect({ type: "text", data: "Call John Smith on +91 98765 43210" });
    expect(r.safeData).toMatch(/^Call \w+ \w+ on \+91 98765 43210$/);
    expect(r.safeData).not.toContain("John");
  });

  it("full definition with restore:false and output overrides", async () => {
    const aran = make({
      policy: {
        name: "support-desk",
        extends: "default",
        failMode: "closed",
        minConfidence: 0.5,
        defaultAction: "redact",
        entities: {
          PERSON: "tokenize",
          EMAIL: { action: "tokenize", restore: false },
          PHONE: { action: "redact", minConfidence: 0.8 },
          CREDIT_CARD: "block",
        },
        output: {
          restoreTokens: true,
          unexpectedEntityAction: "redact",
          entities: { API_KEY: "block" },
        },
      },
    });
    const p = await aran.protect({ type: "text", data: "Ravi Kumar, ravi@example.com" });
    const r = await aran.release("Hi [PERSON_001] at [EMAIL_001]", p.sessionId);
    expect(r.data).toBe("Hi Ravi Kumar at [EMAIL_001]");
    expect(
      (
        await aran.release(
          `key ${"AKIA" + "IOSFODNN7EXAMPLE"} sk-proj-Q7tR2vX9mK4pL8nB3cZ6wY1aE5dF0gH`,
          p.sessionId,
        )
      ).status,
    ).toBe("blocked");
  });

  it("validated custom entity detector", async () => {
    const aran = make();
    aran.entities.register({
      name: "VEHICLE_REG",
      detector: {
        pattern: /\b[A-Z]{2}\s?\d{2}\s?[A-Z]{1,2}\s?\d{4}\b/,
        validate: (value) => !value.startsWith("XX"),
      },
    });
    const r = await aran.protect({ type: "text", data: "Car TN 09 AB 1234 and XX 01 AB 0000" });
    expect(r.safeData).toBe("Car [VEHICLE_REG_REDACTED] and XX 01 AB 0000");
  });

  it("matches purposes by id and most specific keyword", async () => {
    const aran = make({ policy: "healthcare" });
    const r = await aran.protect({
      type: "text",
      data: "Patient John Smith",
      purpose: "appointment reminder",
    });
    expect(r.minimization.matchedRule).toBe("patient-communication");
    expect(r.safeData).toBe("Patient [PERSON_001]");
  });
});

describe("guide chapter 8 — providers", () => {
  it("generate() sends a redacted image plus sanitized text", async () => {
    const seen: AIRequest[] = [];
    const provider = createProvider("mock", async (req) => {
      seen.push(req);
      return "ok";
    });
    await make().generate(provider, {
      type: "image",
      data: await makeImage(["Email: ravi.kumar@example.com"]),
    });
    const content = seen[0]!.messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as { type: string; text?: string; mimeType?: string }[];
    expect(parts[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(parts[1]!.text).toContain("Text visible in the image (sanitized)");
    expect(JSON.stringify(seen)).not.toContain("ravi.kumar@example.com");
  });

  it("release() extends the session lifetime", async () => {
    const aran = make({ sessionTtlMs: 200 });
    const p = await aran.protect({ type: "text", data: "Ravi Kumar" });
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 120));
      expect((await aran.release("[PERSON_001]", p.sessionId)).data).toBe("Ravi Kumar");
    }
  });
});
