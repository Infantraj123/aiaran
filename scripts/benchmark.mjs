// ARAN benchmarks. Run `npm run build` first. Usage: node scripts/benchmark.mjs [case ...]
// All inputs are synthetic and generated in memory.
import { randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { Aran } from "../dist/index.js";
import { makeDocx, makeImage, makeTextPdf } from "./fixtures.mjs";

const LINE =
  "Patient Ravi Kumar (patient ID P123456), email ravi.kumar@example.com, phone +91 98765 43210, BP 150/95. ";

function textOfSize(bytes) {
  let s = "";
  while (s.length < bytes) s += LINE;
  return s.slice(0, bytes);
}

async function pdfOfSize(targetBytes) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  while (true) {
    const page = doc.addPage([612, 792]);
    for (let i = 0; i < 30; i++)
      page.drawText(LINE.slice(0, 90), { x: 30, y: 760 - i * 24, size: 10, font });
    // Incompressible image payload to reach the target size without OCR-heavy content.
    const noise = await sharp(randomBytes(400 * 400 * 3), {
      raw: { width: 400, height: 400, channels: 3 },
    })
      .png()
      .toBuffer();
    const img = await doc.embedPng(noise);
    page.drawImage(img, { x: 400, y: 20, width: 150, height: 150 });
    const size = (await doc.save()).length;
    if (size >= targetBytes) return Buffer.from(await doc.save());
  }
}

const cases = {
  "text-1kb": async () => ({ type: "text", data: textOfSize(1024) }),
  "text-100kb": async () => ({ type: "text", data: textOfSize(100 * 1024) }),
  "text-1mb": async () => ({ type: "text", data: textOfSize(1024 * 1024) }),
  "pdf-100-pages": async () => ({
    type: "pdf",
    data: await makeTextPdf(
      Array.from({ length: 100 }, () => Array.from({ length: 30 }, () => LINE.slice(0, 90))),
    ),
  }),
  "pdf-10mb": async () => ({ type: "pdf", data: await pdfOfSize(10 * 1024 * 1024) }),
  "image-1080p": async () => {
    const text = await makeImage(
      Array.from({ length: 12 }, () => LINE.slice(0, 60)),
      { width: 1920, fontSize: 30 },
    );
    return {
      type: "image",
      data: await sharp(text)
        .resize(1920, 1080, { fit: "contain", background: "#fff" })
        .png()
        .toBuffer(),
    };
  },
  "docx-large": async () => ({
    type: "docx",
    data: makeDocx({ paragraphs: Array.from({ length: 5000 }, () => LINE) }),
    mode: "document",
  }),
};

const selected = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(cases);
const aran = new Aran({ logger: false, limits: { timeoutMs: 600_000, maxEntities: 1_000_000 } });

console.log("case             input      time(ms)   entities  heap(MB)  status");
for (const name of selected) {
  const make = cases[name];
  if (!make) throw new Error(`Unknown case ${name}`);
  const input = await make();
  const size = typeof input.data === "string" ? Buffer.byteLength(input.data) : input.data.length;
  // Warm-up (initialises OCR workers etc.) for non-text inputs.
  if (input.type !== "text") await aran.scan(input).catch(() => undefined);
  global.gc?.();
  const started = performance.now();
  const result = await aran.protect(input);
  const ms = performance.now() - started;
  const heap = process.memoryUsage().heapUsed / 1024 / 1024;
  console.log(
    `${name.padEnd(16)} ${(size / 1024).toFixed(0).padStart(7)}KB ${ms.toFixed(0).padStart(10)} ${String(result.summary.total).padStart(10)} ${heap.toFixed(0).padStart(9)}  ${result.status}`,
  );
  await aran.destroySession(result.sessionId);
}
await aran.dispose();
