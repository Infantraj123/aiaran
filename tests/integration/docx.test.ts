import { afterAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { Aran } from "../../src/index.js";
import { makeDocx, makeImage } from "../../scripts/fixtures.mjs";
import { S } from "../helpers/synthetic.js";

const aran = new Aran({ policy: "healthcare", logger: false });
afterAll(() => aran.dispose());

function parts(docx: Buffer): Record<string, string> {
  const files = unzipSync(new Uint8Array(docx));
  return Object.fromEntries(
    Object.entries(files)
      .filter(([n]) => n.endsWith(".xml") || n.endsWith(".rels"))
      .map(([n, d]) => [n, strFromU8(d)]),
  );
}

describe("DOCX → extraction → protection", () => {
  const docx = makeDocx({
    paragraphs: [
      ["Dear ", "Ravi ", "Ku", "mar", ","],
      `Your patient ID is P123456 & phone ${S.phoneIn}.`,
      "Plain clinical text <unchanged>.",
    ],
    table: [
      ["Field", "Value"],
      ["Email", S.email],
      ["PAN", S.pan],
    ],
    header: `Confidential — ${S.name}`,
    hyperlinkEmail: S.email,
    deletedText: `Old email ${S.email}`,
  });

  it("content mode returns sanitized text", async () => {
    const r = await aran.protect({ type: "docx", data: docx });
    const d = r.safeData!;
    expect(d.document).toBeUndefined();
    expect(d.text).toContain("Dear [PERSON_001],");
    expect(d.text).toContain("patient ID is [PATIENT_ID_001] & phone [PHONE_REDACTED].");
    expect(d.text).toContain("Confidential — [PERSON_001]");
    expect(d.text).not.toContain(S.email);
  });

  it("document mode preserves structure and removes values everywhere", async () => {
    const r = await aran.protect({
      type: "docx",
      data: docx,
      mode: "document",
      filename: "letter.docx",
    });
    expect(r.status).toBe("safe");
    const out = r.safeData!.document!;
    const xml = parts(out);
    const all = Object.values(xml).join("\n");
    for (const v of ["Ravi", "Kumar", S.email, "98765", S.pan, "P123456"])
      expect(all).not.toContain(v);

    const doc = xml["word/document.xml"]!;
    // Structure preserved: heading style, table, rows/cells, run count for the split name.
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect((doc.match(/<w:tr>/g) ?? []).length).toBe(3);
    expect((doc.match(/<w:tc>/g) ?? []).length).toBe(6);
    // Token written into the first run; subsequent runs that held the name are emptied.
    expect(doc).toContain('<w:t xml:space="preserve">[PERSON_001]</w:t>');
    // XML escaping is intact.
    expect(doc).toContain("Plain clinical text &lt;unchanged&gt;.");
    expect(doc).toContain("&amp; phone");
    expect(xml["word/_rels/document.xml.rels"]).toContain('Target="mailto:[EMAIL_REDACTED]"');
    expect(doc).toContain("Old email [EMAIL_REDACTED]");
    expect(doc).toContain('w:author="ARAN"');
    expect(xml["docProps/core.xml"]).toContain("<dc:creator></dc:creator>");
    expect(xml["word/header1.xml"]).toContain("[PERSON_001]");

    // The output is itself a valid DOCX that ARAN can re-read with nothing left to find.
    const rescan = await aran.scan({ type: "docx", data: out });
    expect(rescan.detectedEntities.filter((e) => e.type !== "AGE")).toEqual([]);
  });

  it("OCRs and redacts embedded images", async () => {
    const img = await makeImage([`Email: ${S.email}`]);
    const withImage = makeDocx({
      paragraphs: ["See attached scan."],
      extraEntries: { "word/media/image1.png": new Uint8Array(img) },
    });
    const r = await aran.protect({ type: "docx", data: withImage, mode: "document" });
    expect(r.status).toBe("safe");
    expect(r.detectedEntities.map((e) => e.type)).toContain("EMAIL");
    const media = unzipSync(new Uint8Array(r.safeData!.document!))["word/media/image1.png"]!;
    expect(Buffer.from(media).equals(img)).toBe(false);
  });

  it("warns when embedded media cannot be inspected", async () => {
    const noOcr = new Aran({ ocr: false, logger: false });
    const withEmf = makeDocx({
      paragraphs: ["x"],
      extraEntries: { "word/media/image1.emf": new Uint8Array([1, 2, 3]) },
    });
    const r = await noOcr.protect({ type: "docx", data: withEmf });
    expect(r.status).toBe("uncertain");
    expect(r.warnings.map((w) => w.code)).toContain("EMBEDDED_MEDIA_NOT_INSPECTED");
    await noOcr.dispose();
  });
});
