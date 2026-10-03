import { describe, expect, it } from "vitest";
import { Aran, type AuditEvent, type Logger } from "../../src/index.js";
import { S, SENSITIVE_VALUES, assertNoLeak } from "../helpers/synthetic.js";

const document = [
  `Name: ${S.name}`,
  `Email ${S.email}, phone ${S.phoneIn}`,
  `Aadhaar ${S.aadhaar}, PAN ${S.pan}, SSN ${S.ssn}`,
  `Card ${S.card}`,
  `OPENAI_API_KEY=${S.openaiKey} AWS ${S.awsKey} GH ${S.githubToken}`,
  `jwt ${S.jwt}`,
  `DATABASE_URL=${S.dbUrl}`,
].join("\n");

function recordingLogger(lines: string[]): Logger {
  const rec = (m: string, f?: Record<string, unknown>): void =>
    void lines.push(`${m} ${JSON.stringify(f ?? {})}`);
  return { debug: rec, info: rec, warn: rec, error: rec };
}

describe("PII leakage", () => {
  it("never leaks sensitive values into the safe payload, metadata, logs or audit events", async () => {
    const logs: string[] = [];
    const audit: AuditEvent[] = [];
    const aran = new Aran({ logger: recordingLogger(logs), audit: (e) => void audit.push(e) });
    const result = await aran.protect({ type: "text", data: document });
    expect(result.status).toBe("safe");

    expect(assertNoLeak(String(result.safeData))).toEqual([]);
    const { safeData: _s, protectedData: _p, ...rest } = result;
    expect(assertNoLeak(JSON.stringify(rest))).toEqual([]);
    expect(assertNoLeak(logs.join("\n"))).toEqual([]);
    expect(assertNoLeak(JSON.stringify(audit))).toEqual([]);
    expect(logs.join("\n")).toContain("entityCounts");

    const release = await aran.release(
      `Contact [PERSON_001] at ${S.email}; key ${S.openaiKey}`,
      result.sessionId,
    );
    const { data, ...releaseMeta } = release;
    expect(assertNoLeak(JSON.stringify(releaseMeta))).toEqual([]);
    // Unexpected secrets in output are redacted by the default output policy.
    expect(data).not.toContain(S.openaiKey);
    expect(assertNoLeak(logs.join("\n"))).toEqual([]);
    await aran.dispose();
  });

  it("scan() results contain no values", async () => {
    const aran = new Aran({ logger: false });
    const scan = await aran.scan({ type: "text", data: document });
    expect(scan.summary.total).toBeGreaterThanOrEqual(10);
    expect(assertNoLeak(JSON.stringify(scan))).toEqual([]);
    await aran.dispose();
  });

  it("error messages never echo input values", async () => {
    const aran = new Aran({ logger: false, limits: { maxTextBytes: 64 } });
    const errors: string[] = [];
    for (const attempt of [
      () => aran.protect({ type: "text", data: document }),
      () => aran.protect({ type: "pdf", data: Buffer.from(`%PDF-1.7 ${S.email} garbage`) }),
      () => aran.protect({ type: "image", data: Buffer.from(`not an image ${S.email}`) }),
      () => aran.protect({ type: "text", data: { when: new Date(), who: S.email } }),
      () => aran.protect({ type: "text", data: S.email, sessionId: S.email }),
    ]) {
      const err = await attempt().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      errors.push(`${(err as Error).message} ${JSON.stringify(err)}`);
    }
    expect(assertNoLeak(errors.join("\n"), [...SENSITIVE_VALUES, S.email])).toEqual([]);
    await aran.dispose();
  });

  it("tokens never contain fragments of original values", async () => {
    const aran = new Aran({ logger: false });
    const result = await aran.protect({ type: "text", data: document });
    for (const action of result.actions) {
      if (action.replacement) expect(action.replacement).toMatch(/^\[[A-Z_]+_(\d{3,}|REDACTED)\]$/);
    }
    await aran.dispose();
  });
});
