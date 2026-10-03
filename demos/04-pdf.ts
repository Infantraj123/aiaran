/**
 * Demo 4 — PDF: content mode, document mode, scanned PDFs
 * Needs: npm install pdfjs-dist pdf-lib  (+ tesseract.js @tesseract.js-data/eng for scanned pages)
 * Run:   node demos/04-pdf.ts [your.pdf]
 */
import { Aran } from "aiaran";
import {
  inputFile,
  makeSampleScannedPdf,
  makeSampleTextPdf,
  printEntities,
  printWarnings,
  save,
  step,
  title,
} from "./_shared.ts";

title("DEMO 4 — Protecting PDFs");

const aran = new Aran({ policy: "healthcare" });
const input = await inputFile(() => makeSampleTextPdf(), "sample-report.pdf");

step("1. Content mode (default): sanitized text, page by page");
const content = await aran.protect({ type: "pdf", data: input.data });
console.log("status:", content.status, "| pages:", content.metadata.pages);
printEntities(content.detectedEntities, content.actions);
printWarnings(content.warnings);
for (const page of content.safeData?.pages ?? []) {
  console.log(`\n[page ${page.page} — text from ${page.source}]\n${page.text}`);
}

step("2. Document mode: a new, sanitized PDF file");
const doc = await aran.protect({ type: "pdf", data: input.data, mode: "document" });
console.log("status:", doc.status);
if (doc.status === "safe" && doc.safeData?.document) {
  console.log("sanitized PDF :", save("report.sanitized.pdf", doc.safeData.document));
  console.log("  • every page is a flattened image with black boxes over sensitive values");
  console.log("  • no text layer, metadata, links, forms, attachments or JavaScript survive");
} else {
  // Never treat an "uncertain" document as sanitized.
  printWarnings(doc.warnings);
}

step("3. Scanned PDF (no text layer) → pages are rendered and OCR'd locally");
const scanned = await makeSampleScannedPdf();
save("sample-scanned.pdf", scanned);
const s = await aran.protect({ type: "pdf", data: scanned });
console.log(
  "status:",
  s.status,
  "| page source:",
  s.safeData?.pages?.map((p) => p.source),
);
console.log(s.safeData?.text);

step("4. What 'fail-closed' looks like: OCR switched off for a scanned PDF");
const noOcr = new Aran({ policy: "healthcare", ocr: false });
const blind = await noOcr.protect({ type: "pdf", data: scanned });
console.log("status:", blind.status, "| safeData:", blind.safeData);
printWarnings(blind.warnings);
await noOcr.dispose();

await aran.dispose();
