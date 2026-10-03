/**
 * Helpers shared by the ARAN demos.
 *
 * Every sample created here is SYNTHETIC — the names, numbers and keys are
 * fictitious. The sample builders only use packages that the corresponding
 * ARAN feature already needs (sharp for images, pdf-lib for PDFs, fflate for
 * DOCX), so a demo runs as soon as that feature is installed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DetectedEntity, ProtectionAction, Warning } from "aiaran";

export const OUTPUT_DIR = "demos/output";
mkdirSync(OUTPUT_DIR, { recursive: true });

export function title(text: string): void {
  console.log(`\n${"=".repeat(72)}\n${text}\n${"=".repeat(72)}`);
}

export function step(text: string): void {
  console.log(`\n--- ${text} ---`);
}

/** Print detected entities next to the action taken — never the original values. */
export function printEntities(entities: DetectedEntity[], actions: ProtectionAction[]): void {
  if (entities.length === 0) {
    console.log("(no sensitive entities detected)");
    return;
  }
  console.log("ID    TYPE                    CONF   WHERE              ACTION        REPLACEMENT");
  for (const e of entities) {
    const a = actions.find((x) => x.entityId === e.id);
    const where =
      e.page !== undefined
        ? `page ${e.page}`
        : e.start !== undefined
          ? `chars ${e.start}-${e.end}`
          : "region";
    console.log(
      `${e.id.padEnd(5)} ${e.type.padEnd(23)} ${e.confidence.toFixed(2).padEnd(6)} ${where.padEnd(18)} ${(a?.action ?? "-").padEnd(13)} ${a?.replacement ?? ""}`,
    );
  }
}

export function printWarnings(warnings: Warning[]): void {
  if (warnings.length === 0) {
    console.log("Warnings: none");
    return;
  }
  console.log("Warnings:");
  for (const w of warnings)
    console.log(
      `  [${w.severity}] ${w.code}${w.page !== undefined ? ` (page ${w.page})` : ""}: ${w.message}`,
    );
}

export function save(name: string, data: Buffer | string): string {
  const path = join(OUTPUT_DIR, name);
  writeFileSync(path, data);
  return path;
}

/** Use the file given on the command line, or build a synthetic sample. */
export async function inputFile(
  build: () => Promise<Buffer> | Buffer,
  sampleName: string,
): Promise<{ data: Buffer; name: string }> {
  const arg = process.argv[2];
  if (arg) return { data: readFileSync(arg), name: arg };
  const data = await build();
  const path = save(sampleName, data);
  console.log(`No file given — created synthetic sample: ${path}`);
  return { data, name: path };
}

// ── Synthetic sample builders ─────────────────────────────────────────────

export const SAMPLE_LINES = [
  "Patient: Ravi Kumar",
  "Patient ID P123456, age 52",
  "Email: ravi.kumar@example.com",
  "Phone: +91 98765 43210",
  "Aadhaar 2345 6789 0124   PAN ABCPK1234F",
  "Blood pressure 150/95. Follow-up in 2 weeks.",
];

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** PNG "screenshot" with text (rendered by sharp from SVG). */
export async function makeSampleImage(lines: string[] = SAMPLE_LINES): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const height = 80 + lines.length * 56;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${height}">` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    lines
      .map(
        (l, i) =>
          `<text x="40" y="${70 + i * 56}" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" fill="#000">${escapeXml(l)}</text>`,
      )
      .join("") +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** PDF with a real text layer (like a PDF exported from Word). */
export async function makeSampleTextPdf(
  pages: string[][] = [
    SAMPLE_LINES,
    ["Page 2: reviewed by Dr. Priya Raman at Lotus Valley Hospital."],
  ],
): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setAuthor("Ravi Kumar"); // metadata that must not survive document mode
  doc.setTitle("Discharge summary — Ravi Kumar");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 22, size: 12, font }));
  }
  return Buffer.from(await doc.save());
}

/** "Scanned" PDF: one image per page, no text layer. */
export async function makeSampleScannedPdf(lines: string[] = SAMPLE_LINES): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const png = await makeSampleImage(lines);
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([612, (612 * img.height) / img.width]);
  page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return Buffer.from(await doc.save());
}

/** Word document with a heading, a name split across runs, a table, a header, a mailto link and a tracked deletion. */
export async function makeSampleDocx(): Promise<Buffer> {
  const { strToU8, zipSync } = await import("fflate");
  const run = (t: string): string => `<w:r><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r>`;
  const para = (runs: string[], style?: string): string =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs.map(run).join("")}</w:p>`;
  const cell = (t: string): string => `<w:tc><w:p>${run(t)}</w:p></w:tc>`;
  const NS =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const body =
    para(["Appointment letter"], "Heading1") +
    para(["Dear ", "Ravi ", "Ku", "mar", ","]) + // Word often splits words across runs like this
    para(["Your patient ID is P123456. We will call you on +91 98765 43210."]) +
    `<w:tbl>` +
    `<w:tr>${cell("Field")}${cell("Value")}</w:tr>` +
    `<w:tr>${cell("Email")}${cell("ravi.kumar@example.com")}</w:tr>` +
    `<w:tr>${cell("PAN")}${cell("ABCPK1234F")}</w:tr>` +
    `</w:tbl>` +
    `<w:p><w:hyperlink r:id="rIdLink">${run("Email us")}</w:hyperlink></w:p>` +
    `<w:p><w:del w:id="1" w:author="Ravi Kumar" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Old phone 91234 56789</w:delText></w:r></w:del></w:p>` +
    para(["Blood pressure 150/95. Please bring your previous reports."]);
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr></w:body></w:document>`,
    "word/_rels/document.xml.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:ravi.kumar@example.com" TargetMode="External"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>',
    "word/header1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${para(["Confidential — Ravi Kumar"])}</w:hdr>`,
    "docProps/core.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Ravi Kumar</dc:creator><cp:lastModifiedBy>Ravi Kumar</cp:lastModifiedBy><dc:title>Letter</dc:title></cp:coreProperties>',
  };
  return Buffer.from(
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))),
  );
}
