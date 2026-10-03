import { describe, expect, it } from "vitest";
import { Aran, createProvider, type AIRequest } from "../../src/index.js";
import { S, assertNoLeak } from "../helpers/synthetic.js";

/** Mock AI that echoes the placeholders it received, like a real model would. */
function echoModel(seen: AIRequest[]) {
  return createProvider("echo", async (req) => {
    seen.push(req);
    const user = req.messages[0]!.content as string;
    const tokens = user.match(/\[[A-Z_]+_\d{3}\]/g) ?? [];
    return `Summary: ${tokens.join(", ")}. Remember to reach out.`;
  });
}

describe("text → protect → AI → release", () => {
  it("round-trips a multilingual medical note", async () => {
    const aran = new Aran({ policy: "healthcare", logger: false });
    const note = [
      `Patient ${S.name}, patient ID P123456, age 61.`,
      `Phone ${S.phoneIn}, email ${S.email}.`,
      "मरीज़ का नाम: राहुल शर्मा",
      "நோயாளி பெயர்: மீனா சுந்தரம்",
      "Diagnosis: hypertension; BP 150/95.",
    ].join("\n");
    const seen: AIRequest[] = [];
    const result = await aran.generate(echoModel(seen), { type: "text", data: note });

    const sent = JSON.stringify(seen);
    expect(
      assertNoLeak(sent, [
        S.name,
        S.email,
        "98765 43210",
        "P123456",
        "राहुल शर्मा",
        "மீனா சுந்தரம்",
      ]),
    ).toEqual([]);
    expect(sent).toContain("hypertension");
    expect(sent).toContain("age 61");
    // PERSON and PATIENT_ID tokens are restored; email/phone were redacted and never tokenized.
    expect(result.text).toContain(S.name);
    expect(result.text).toContain("P123456");
    expect(result.text).toContain("राहुल शर्मा");
    expect(result.text).toContain("மீனா சுந்தரம்");
    expect(result.release.restoredTokens).toBe(4);
    await aran.dispose();
  });

  it("handles source code and logs with the developer policy", async () => {
    const aran = new Aran({ policy: "developer", logger: false });
    const code = `const client = new Client({ apiKey: "${S.openaiKey}" });
// TODO(${S.email}): rotate
db = connect("${S.dbUrl}")
2026-10-03T10:00:00Z ERROR auth failed for user=ravi_k ip=${S.ipv4}
    at handler (/srv/app/auth.ts:42:13)`;
    const r = await aran.protect({ type: "text", data: code });
    const out = r.safeData as string;
    expect(assertNoLeak(out, [S.openaiKey, S.email, "S3cr3tPassw0rd", S.ipv4])).toEqual([]);
    expect(out).toContain("[API_KEY_REDACTED]");
    expect(out).toContain("[DATABASE_URL_REDACTED]");
    expect(out).toContain("at handler (/srv/app/auth.ts:42:13)");
    await aran.dispose();
  });

  it("keeps multi-turn conversations consistent within one session", async () => {
    const aran = new Aran({ logger: false });
    const t1 = await aran.protect({ type: "text", data: `I am ${S.westernName}, mail ${S.email}` });
    const t2 = await aran.protect({
      type: "text",
      data: `Please email ${S.email} again`,
      sessionId: t1.sessionId,
    });
    expect(t1.safeData).toContain("[EMAIL_001]");
    expect(t2.safeData).toBe("Please email [EMAIL_001] again");
    expect(await aran.restore("Sent to [EMAIL_001] for [PERSON_001].", t1.sessionId)).toBe(
      `Sent to ${S.email} for ${S.westernName}.`,
    );
    await aran.dispose();
  });
});
