import { afterAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { Aran } from "../../src/index.js";
import { makeImage, makeScannedPdf, makeTextPdf } from "../../scripts/fixtures.mjs";
import { pdfTextAndInfo } from "../helpers/pdf.js";
import { S } from "../helpers/synthetic.js";

const aran = new Aran({ policy: "healthcare", logger: false });
afterAll(() => aran.dispose());

const lines = [
  `Patient: ${S.name}`,
  `Email: ${S.email}`,
  `Patient ID P123456, age 52`,
  `Aadhaar ${S.aadhaar}`,
];

describe("PDF → extraction → protection", () => {
  it("content mode returns sanitized per-page text from the text layer", async () => {
    const pdf = await makeTextPdf([lines, ["Page two: Dr. Priya Raman"]]);
    const r = await aran.protect({ type: "pdf", data: pdf });
    expect(r.status).toBe("safe");
    expect(r.metadata.pages).toBe(2);
    const d = r.safeData!;
    expect(d.pages?.map((p) => p.source)).toEqual(["text", "text"]);
    expect(d.text).toContain("Patient: [PERSON_001]");
    expect(d.text).toContain("[AADHAAR_REDACTED]");
    expect(d.pages![1]!.text).toContain("[PERSON_002]");
    expect(d.document).toBeUndefined();
    expect(r.detectedEntities.find((e) => e.type === "EMAIL")?.page).toBe(1);
  });

  it("OCRs scanned (image-only) pages", async () => {
    const r = await aran.protect({ type: "pdf", data: await makeScannedPdf(lines) });
    expect(r.status).toBe("safe");
    expect(r.safeData!.pages![0]!.source).toBe("ocr");
    expect(r.safeData!.text).toContain("[PERSON_001]");
    expect(r.safeData!.text).not.toContain(S.email);
  });

  it("document mode produces a flattened PDF with no recoverable text or metadata", async () => {
    const pdf = await makeTextPdf([lines]);
    const before = await pdfTextAndInfo(pdf);
    expect(before.text).toContain(S.email);
    const r = await aran.protect({ type: "pdf", data: pdf, mode: "document" });
    const out = r.safeData!.document!;
    expect(r.safeData!.mimeType).toBe("application/pdf");
    const after = await pdfTextAndInfo(out);
    expect(after.pages).toBe(1);
    expect(after.text.trim()).toBe("");
    expect(JSON.stringify(after.info)).not.toContain("Ravi");
    expect(out.includes(Buffer.from("Ravi"))).toBe(false);
    // Visual check: OCR the sanitized PDF; the sensitive values are gone.
    const rescan = await aran.scan({ type: "pdf", data: out });
    expect(
      rescan.detectedEntities.filter((e) => ["EMAIL", "AADHAAR", "PATIENT_ID"].includes(e.type)),
    ).toEqual([]);
  });

  it("verifies redactions with OCR in strict mode", async () => {
    const strict = new Aran({ policy: "healthcare", mode: "strict", logger: false });
    const r = await strict.protect({
      type: "pdf",
      data: await makeTextPdf([lines]),
      mode: "document",
    });
    expect(r.status).toBe("safe");
    expect(r.warnings.map((w) => w.code)).not.toContain("PDF_VERIFICATION_FAILED");
    await strict.dispose();
  });

  it("OCRs images embedded in text pages", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText("Referral letter attached below.", { x: 50, y: 740, size: 12 });
    const img = await doc.embedPng(await makeImage([`Email: ${S.email}`], { width: 900 }));
    page.drawImage(img, { x: 50, y: 500, width: 450, height: (450 * img.height) / img.width });
    const r = await aran.protect({ type: "pdf", data: Buffer.from(await doc.save()) });
    expect(r.safeData!.text).toContain("Referral letter");
    expect(r.safeData!.text).toContain("[EMAIL_REDACTED]");
  });

  it("never claims a PDF is sanitized when inspection fails", async () => {
    const noOcr = new Aran({ policy: "healthcare", ocr: false, logger: false });
    const r = await noOcr.protect({
      type: "pdf",
      data: await makeScannedPdf(lines),
      mode: "document",
    });
    expect(r.status).toBe("uncertain");
    expect(r.safeData).toBeNull(); // healthcare policy is fail-closed
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["OCR_UNAVAILABLE", "FAIL_CLOSED_WITHHELD"]),
    );
    await noOcr.dispose();
  });

  it("enforces the page limit", async () => {
    const small = new Aran({ limits: { maxPdfPages: 1 }, logger: false });
    await expect(
      small.protect({ type: "pdf", data: await makeTextPdf([["a"], ["b"]]) }),
    ).rejects.toThrow(/page count/);
    await small.dispose();
  });
});
