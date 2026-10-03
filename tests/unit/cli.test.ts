import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli/main.js";
import { makeDocx } from "../../scripts/fixtures.mjs";
import { S } from "../helpers/synthetic.js";

let dir: string;
let output: string[];
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "aran-cli-"));
});
afterEach(() => vi.restoreAllMocks());

function capture(): void {
  output = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });
}

const sample = `Patient ${S.name}, email ${S.email}, Aadhaar ${S.aadhaar}, key ${S.openaiKey}`;

describe("CLI", () => {
  it("scans without printing sensitive values", async () => {
    const file = join(dir, "note.txt");
    await writeFile(file, sample);
    capture();
    expect(await main(["scan", file])).toBe(0);
    const text = output.join("");
    expect(text).toContain("ARAN Privacy Scanner");
    expect(text).toMatch(/EMAIL\s+1/);
    expect(text).toContain("Risk level: CRITICAL");
    expect(text).toContain("No sensitive values displayed.");
    for (const v of [S.name, S.email, S.aadhaar, S.openaiKey]) expect(text).not.toContain(v);
  });

  it("emits JSON summaries", async () => {
    const file = join(dir, "note2.txt");
    await writeFile(file, sample);
    capture();
    await main(["scan", file, "--json"]);
    const json = JSON.parse(output.join("")) as { summary: { counts: Record<string, number> } };
    expect(json.summary.counts.EMAIL).toBe(1);
  });

  it("protects files and refuses to overwrite without --force", async () => {
    const file = join(dir, "note3.txt");
    await writeFile(file, `Patient ${S.name}, email ${S.email}`);
    capture();
    expect(await main(["protect", file])).toBe(0);
    const out = await readFile(join(dir, "note3.protected.txt"), "utf8");
    expect(out).toBe("Patient [PERSON_001], email [EMAIL_001]");
    await expect(main(["protect", file])).rejects.toThrow(/--force/);
    await expect(main(["protect", file, "--out", file, "--force"])).rejects.toThrow(
      /overwrite the input/,
    );
  });

  it("returns exit code 3 when blocked", async () => {
    const file = join(dir, "secret.txt");
    await writeFile(file, `token ${S.githubToken}`);
    capture();
    expect(await main(["protect", file, "--policy", "strict"])).toBe(3);
    expect(output.join("")).toContain("BLOCKED");
  });

  it("protects DOCX in document mode", async () => {
    const file = join(dir, "letter.docx");
    await writeFile(file, makeDocx({ paragraphs: [`Dear ${S.name}`] }));
    capture();
    expect(await main(["protect", file, "--mode", "document"])).toBe(0);
    const out = await readFile(join(dir, "letter.protected.docx"));
    expect(out.subarray(0, 2).toString()).toBe("PK");
    expect(out.includes(Buffer.from("Ravi"))).toBe(false);
  });

  it("validates policies", async () => {
    const good = join(dir, "good.yaml");
    const bad = join(dir, "bad.yaml");
    await writeFile(good, "name: ok\nentities:\n  EMAIL: redact\n");
    await writeFile(bad, "entities:\n  EMAIL: explode\n");
    capture();
    expect(await main(["policy", "validate", good])).toBe(0);
    expect(await main(["policy", "validate", bad])).toBe(2);
    expect(output.join("")).toContain('Invalid action "explode"');
  });

  it("lists providers, policies and entities", async () => {
    capture();
    expect(await main(["providers", "list"])).toBe(0);
    expect(await main(["policies", "list"])).toBe(0);
    expect(await main(["entities", "list"])).toBe(0);
    const text = output.join("");
    expect(text).toContain("anthropic");
    expect(text).toContain("healthcare");
    expect(text).toContain("AADHAAR");
  });

  it("handles usage errors", async () => {
    capture();
    expect(await main([])).toBe(1);
    await expect(main(["scan"])).rejects.toThrow(/Missing file/);
    await expect(main(["scan", join(dir, "missing.txt")])).rejects.toThrow(/not found/);
    await expect(main(["scan", join(dir, "note.txt"), "--type", "audio"])).rejects.toThrow(
      /--type/,
    );
  });
});
