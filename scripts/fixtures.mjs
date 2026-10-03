// Synthetic fixture builders. All personal data here is fictitious.
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strToU8, zipSync } from "fflate";

export const SYNTHETIC = {
  name: "Ravi Kumar",
  email: "ravi.kumar@example.com",
  phone: "+91 98765 43210",
  aadhaar: "2345 6789 0124",
  pan: "ABCPK1234F",
  patientId: "P123456",
  card: "4111 1111 1111 1111",
  apiKey: "sk-proj-Q7tR2vX9mK4pL8nB3cZ6wY1aE5dF0gH",
};

/** Render text lines to a PNG (black on white) — used for OCR fixtures. */
export async function makeImage(lines, { width = 1400, fontSize = 34 } = {}) {
  const lineHeight = Math.round(fontSize * 1.6);
  const canvas = createCanvas(width, lineHeight * lines.length + 80);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = `${fontSize}px "DejaVu Sans"`;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, 40, 40 + i * lineHeight));
  return Buffer.from(await canvas.encode("png"));
}

/** PDF with a real text layer. */
export async function makeTextPdf(pages) {
  const doc = await PDFDocument.create();
  doc.setAuthor("Ravi Kumar");
  doc.setTitle("Discharge summary for Ravi Kumar");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 22, size: 12, font }));
  }
  return Buffer.from(await doc.save());
}

/** Image-only ("scanned") PDF: no text layer. */
export async function makeScannedPdf(lines) {
  const png = await makeImage(lines, { width: 1224, fontSize: 30 });
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([612, (612 * img.height) / img.width]);
  page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return Buffer.from(await doc.save());
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/**
 * Minimal but valid DOCX. `paragraphs` items are strings or arrays of run
 * strings (to split values across runs). Supports a heading, a table, a
 * header part, a mailto hyperlink and a tracked deletion.
 */
export function makeDocx({
  paragraphs = [],
  table,
  header,
  hyperlinkEmail,
  deletedText,
  author = "Ravi Kumar",
  extraEntries = {},
} = {}) {
  const run = (t) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const para = (p, style) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${(Array.isArray(p) ? p : [p]).map(run).join("")}</w:p>`;
  let body = "";
  body += para("Patient Summary", "Heading1");
  for (const p of paragraphs) body += para(p);
  if (table) {
    body += `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${table
      .map(
        (row) =>
          `<w:tr>${row.map((cell) => `<w:tc><w:p>${run(cell)}</w:p></w:tc>`).join("")}</w:tr>`,
      )
      .join("")}</w:tbl>`;
  }
  if (hyperlinkEmail)
    body += `<w:p><w:hyperlink r:id="rIdLink">${run("Email the patient")}</w:hyperlink></w:p>`;
  if (deletedText) {
    body += `<w:p><w:del w:id="1" w:author="${esc(author)}" w:date="2026-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">${esc(deletedText)}</w:delText></w:r></w:del></w:p>`;
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr>${header ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : ""}</w:sectPr></w:body></w:document>`;
  const rels = [
    hyperlinkEmail
      ? `<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:${esc(hyperlinkEmail)}" TargetMode="External"/>`
      : "",
    header
      ? '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
      : "",
  ].join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${esc(author)}</dc:creator><cp:lastModifiedBy>${esc(author)}</cp:lastModifiedBy><dc:title>Notes</dc:title></cp:coreProperties>`,
  };
  if (header)
    files["word/header1.xml"] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}>${para(header)}</w:hdr>`;
  const zipInput = {};
  for (const [k, v] of Object.entries(files)) zipInput[k] = strToU8(v);
  for (const [k, v] of Object.entries(extraEntries)) zipInput[k] = v;
  return Buffer.from(zipSync(zipInput));
}
