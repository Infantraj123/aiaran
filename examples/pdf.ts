import { readFile, writeFile } from "node:fs/promises";
import { Aran } from "aiaran";

// Requires: npm install pdfjs-dist pdf-lib (and tesseract.js + language data for scanned PDFs)
const aran = new Aran({ policy: "healthcare" });

for (const file of ["test-fixtures/sample-report.pdf", "test-fixtures/sample-scanned.pdf"]) {
  const data = await readFile(file);

  const content = await aran.protect({ type: "pdf", data });
  console.log(
    file,
    content.status,
    content.safeData?.pages?.map((p) => p.source),
  );
  console.log(content.safeData?.text);

  const doc = await aran.protect({ type: "pdf", data, mode: "document" });
  if (doc.status === "safe" && doc.safeData?.document) {
    await writeFile(file.replace(/\.pdf$/, ".sanitized.pdf"), doc.safeData.document);
  } else {
    // Never treat an uncertain result as sanitized.
    console.warn(
      "Not sanitized:",
      doc.warnings.map((w) => w.code),
    );
  }
}
await aran.dispose();
