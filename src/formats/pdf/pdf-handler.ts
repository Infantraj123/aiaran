import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import {
  DocumentProcessingError,
  SecurityError,
  UnsupportedFormatError,
} from "../../core/errors.js";
import { optionalImport } from "../../core/optional.js";
import type { ProtectionContext } from "../../core/pipeline.js";
import type { BoundingBox } from "../../entities/entity-types.js";
import { layoutOcrText, union, pad } from "../../ocr/ocr-engine.js";
import type { PdfOptions } from "../../types/configuration.js";
import type { DocumentMode } from "../../types/input.js";
import type { DocumentSafeData, SafePage } from "../../types/output.js";
import { inspectImage, type RedactionBox } from "../image/image-ocr.js";
import { withTimeout } from "../../security/limits.js";

// Minimal structural types for the optional pdfjs-dist / @napi-rs/canvas / pdf-lib peers.
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}
interface PdfViewport {
  width: number;
  height: number;
  scale: number;
  transform: number[];
}
interface PdfPage {
  getViewport(params: { scale: number }): PdfViewport;
  getTextContent(
    params?: Record<string, unknown>,
  ): Promise<{ items: (PdfTextItem | { type: string })[] }>;
  getOperatorList(): Promise<{ fnArray: number[] }>;
  render(params: Record<string, unknown>): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  /** pdfjs's own Node canvas factory (backed by its @napi-rs/canvas dependency). */
  canvasFactory?: {
    create(width: number, height: number): { canvas: Canvas; context: CanvasContext };
  };
  getPage(n: number): Promise<PdfPage>;
}
interface PdfJs {
  getDocument(params: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
  Util: { transform(a: number[], b: number[]): number[] };
  OPS: Record<string, number>;
}
interface Canvas {
  width: number;
  height: number;
  getContext(type: "2d"): CanvasContext;
  encode(format: "png"): Promise<Buffer>;
}
interface CanvasContext {
  fillStyle: string;
  font: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}
type CanvasFactory = NonNullable<PdfDocument["canvasFactory"]>;
interface PdfLib {
  PDFDocument: {
    create(): Promise<{
      embedPng(png: Buffer): Promise<unknown>;
      addPage(size: [number, number]): {
        drawImage(img: unknown, opts: Record<string, number>): void;
      };
      setProducer(s: string): void;
      setCreator(s: string): void;
      setTitle(s: string): void;
      setAuthor(s: string): void;
      setSubject(s: string): void;
      setKeywords(k: string[]): void;
      save(opts?: Record<string, unknown>): Promise<Uint8Array>;
    }>;
  };
}

interface TextRange {
  start: number;
  end: number;
  box: BoundingBox;
}

const MIN_TEXT_CHARS = 16;
const IMAGE_OPS = [
  "paintImageXObject",
  "paintInlineImageXObject",
  "paintImageMaskXObject",
  "paintImageXObjectRepeat",
  "paintInlineImageXObjectGroup",
];

export interface PdfProcessResult {
  data: DocumentSafeData | null;
  pages: number;
}

/**
 * PDF pipeline.
 * - Text pages: text layer extraction → detection.
 * - Scanned pages / pages with images: render → local OCR → detection.
 * - Document mode: every page is rendered, sensitive regions are painted
 *   over, and a new PDF is assembled from the flattened page images. The
 *   output contains no original text layer, metadata, annotations, forms,
 *   attachments or scripts, so redacted text cannot be recovered by copy/paste.
 */
export async function processPdfInput(
  ctx: ProtectionContext,
  buffer: Buffer,
  mode: DocumentMode,
  options: PdfOptions,
): Promise<PdfProcessResult> {
  const pdfjs = await optionalImport<PdfJs>("pdfjs-dist/legacy/build/pdf.mjs", "PDF processing");
  const scale = clampScale(options.renderScale ?? 2);
  const ocrMode = options.ocr ?? "auto";

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // pdfjs-dist 5.x: never compile font programs with eval (6.x no longer uses eval at all).
    isEvalSupported: false,
    // Refuse to decode embedded images larger than the configured pixel budget.
    maxImageSize: ctx.limits.maxImagePixels,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
    ...standardFontOptions(),
  });

  let doc: PdfDocument;
  try {
    doc = await ctx.deadline.run(loadingTask.promise, () => void loadingTask.destroy());
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new UnsupportedFormatError("Password-protected PDFs are not supported.");
    }
    if (error instanceof SecurityError || (error instanceof Error && error.name === "TimeoutError"))
      throw error;
    throw new DocumentProcessingError("PDF could not be parsed.", { cause: error });
  }

  try {
    const numPages = doc.numPages;
    if (numPages > ctx.limits.maxPdfPages) {
      throw new SecurityError("PDF exceeds the maximum page count.", {
        details: { pages: numPages, limit: ctx.limits.maxPdfPages },
      });
    }

    const needsRender = mode === "document" || ocrMode !== "never";
    const canvas = needsRender ? usableCanvasFactory(doc) : undefined;
    const renderReason =
      "PDF page rendering is unavailable (pdfjs-dist could not load its optional @napi-rs/canvas dependency).";

    const pages: SafePage[] = [];
    const pageImages: { png: Buffer; width: number; height: number }[] = [];
    let documentFailed = mode === "document" && !canvas;

    for (let n = 1; n <= numPages; n++) {
      ctx.deadline.check();
      let page: PdfPage;
      try {
        page = await ctx.deadline.run(doc.getPage(n));
      } catch {
        ctx.warn({
          code: "PDF_PAGE_FAILED",
          message: "A PDF page could not be parsed and was not inspected.",
          severity: "error",
          incomplete: true,
          page: n,
        });
        documentFailed = true;
        continue;
      }
      try {
        const viewport = page.getViewport({ scale });
        const { text: layerText, ranges } = await extractTextLayer(page, viewport, pdfjs);
        const nonWs = layerText.replace(/\s/g, "").length;
        const hasImages = ocrMode === "auto" ? await pageHasImages(page, pdfjs) : false;
        const wantOcr =
          ocrMode === "always" || (ocrMode === "auto" && (nonWs < MIN_TEXT_CHARS || hasImages));

        // 1. Text layer.
        const textSeg = await ctx.processText(layerText, {
          page: n,
          locate: (e) => unionAll(boxesForRange(ranges, e.start, e.end)),
        });
        const boxes: RedactionBox[] = [];
        for (const { entity, action } of textSeg.entities) {
          if (action === "allow") continue;
          const label = textSeg.replacements.find((r) => r.entity.id === entity.id)?.replacement;
          for (const box of boxesForRange(ranges, entity.start, entity.end))
            boxes.push(label ? { box: pad(box, 2 * scale), label } : { box: pad(box, 2 * scale) });
        }

        // 2. Rendering (for OCR and/or document mode).
        let rendered: { canvas: Canvas; png: Buffer } | undefined;
        if ((wantOcr || mode === "document") && canvas) {
          try {
            rendered = await renderPage(ctx, page, viewport, canvas);
          } catch {
            ctx.warn({
              code: "PDF_PAGE_FAILED",
              message: "A PDF page could not be rendered.",
              severity: "error",
              incomplete: true,
              page: n,
            });
            documentFailed = true;
          }
        }

        // 3. OCR for scanned pages and image content.
        let ocrText = "";
        if (wantOcr) {
          if (!rendered) {
            if (nonWs < MIN_TEXT_CHARS || hasImages) {
              ctx.warn({
                code: nonWs < MIN_TEXT_CHARS ? "PDF_SCANNED_PAGE" : "EMBEDDED_MEDIA_NOT_INSPECTED",
                message: `Page content in images could not be OCR'd. ${renderReason}`,
                severity: "error",
                incomplete: true,
                page: n,
              });
            }
          } else {
            const inspection = await inspectImage(ctx, rendered.png, {
              page: n,
              exclude: ranges.map((r) => r.box),
              faces: hasImages || nonWs < MIN_TEXT_CHARS,
            });
            ocrText = inspection.text;
            boxes.push(...inspection.boxes);
          }
        } else if (ocrMode === "never" && nonWs < MIN_TEXT_CHARS) {
          ctx.warn({
            code: "PDF_SCANNED_PAGE",
            message: "Page has little or no text layer and OCR is disabled; it was not inspected.",
            severity: "error",
            incomplete: true,
            page: n,
          });
        }

        const pageText = [textSeg.text, ocrText].filter((t) => t.length > 0).join("\n");
        pages.push({
          page: n,
          text: pageText,
          source: nonWs < MIN_TEXT_CHARS && ocrText ? "ocr" : "text",
        });

        // 4. Document mode: paint redactions onto the rendered page.
        if (mode === "document" && rendered && ctx.mode === "protect") {
          paintBoxes(rendered.canvas, boxes);
          const unscaled = page.getViewport({ scale: 1 });
          pageImages.push({
            png: await rendered.canvas.encode("png"),
            width: unscaled.width,
            height: unscaled.height,
          });
        }
      } finally {
        page.cleanup();
      }
    }

    if (ctx.mode === "scan") return { data: null, pages: numPages };

    const text = pages.map((p) => p.text).join("\n\n");
    const result: DocumentSafeData = { text, pages };

    if (mode === "document") {
      if (documentFailed || pageImages.length !== numPages) {
        ctx.warn({
          code: canvas ? "PDF_DOCUMENT_MODE_FAILED" : "PDF_RENDER_UNAVAILABLE",
          message: canvas
            ? "A sanitized PDF could not be produced for every page; no PDF was returned."
            : `A sanitized PDF could not be produced. ${renderReason}`,
          severity: "error",
          incomplete: true,
        });
      } else {
        if (options.verify) await verifyRedactions(ctx, pageImages);
        result.document = await assemblePdf(pageImages);
        result.mimeType = "application/pdf";
      }
    }
    return { data: result, pages: numPages };
  } finally {
    // loadingTask.destroy() releases the document in both pdfjs-dist 5.x and 6.x.
    await loadingTask.destroy().catch(() => undefined);
  }
}

async function extractTextLayer(
  page: PdfPage,
  viewport: PdfViewport,
  pdfjs: PdfJs,
): Promise<{ text: string; ranges: TextRange[] }> {
  const content = await page.getTextContent({ includeMarkedContent: false });
  let text = "";
  const ranges: TextRange[] = [];
  let prev: { x1: number; y: number; h: number } | undefined;
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const item = raw;
    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    const x = m[4] ?? 0;
    const baseline = m[5] ?? 0;
    const fontHeight = Math.hypot(m[2] ?? 0, m[3] ?? 0) || item.height * viewport.scale || 10;
    const width = item.width * viewport.scale;
    if (item.str.length > 0) {
      if (prev && !text.endsWith("\n") && !text.endsWith(" ") && !item.str.startsWith(" ")) {
        const sameLine = Math.abs(prev.y - baseline) < prev.h * 0.5;
        if (!sameLine) text += "\n";
        else if (x - prev.x1 > fontHeight * 0.2) text += " ";
      }
      const start = text.length;
      text += item.str;
      ranges.push({
        start,
        end: text.length,
        box: { x, y: baseline - fontHeight, width: Math.max(width, 1), height: fontHeight * 1.25 },
      });
      prev = { x1: x + width, y: baseline, h: fontHeight };
    }
    if (item.hasEOL && !text.endsWith("\n")) text += "\n";
  }
  return { text, ranges };
}

/** Boxes (one per text item) covering characters [start, end). */
function boxesForRange(ranges: TextRange[], start: number, end: number): BoundingBox[] {
  const out: BoundingBox[] = [];
  for (const r of ranges) {
    if (r.end <= start || r.start >= end) continue;
    const len = r.end - r.start;
    const from = Math.max(start, r.start) - r.start;
    const to = Math.min(end, r.end) - r.start;
    // Characters are assumed evenly spaced; a small margin absorbs proportional-font error.
    const charW = r.box.width / len;
    const x0 = r.box.x + charW * from - charW * 0.35;
    const x1 = r.box.x + charW * to + charW * 0.35;
    out.push({ x: x0, y: r.box.y, width: x1 - x0, height: r.box.height });
  }
  return out;
}

function unionAll(boxes: BoundingBox[]): BoundingBox | undefined {
  return boxes.length ? boxes.reduce((a, b) => union(a, b)) : undefined;
}

async function pageHasImages(page: PdfPage, pdfjs: PdfJs): Promise<boolean> {
  try {
    const ops = await page.getOperatorList();
    const imageOps = new Set(
      IMAGE_OPS.map((name) => pdfjs.OPS[name]).filter((v): v is number => v !== undefined),
    );
    return ops.fnArray.some((fn) => imageOps.has(fn));
  } catch {
    return true; // be conservative: treat as containing images
  }
}

/** Return pdfjs's canvas factory if it can actually create canvases in this environment. */
function usableCanvasFactory(doc: PdfDocument): CanvasFactory | undefined {
  const factory = doc.canvasFactory;
  if (!factory) return undefined;
  try {
    factory.create(1, 1);
    return factory;
  } catch {
    return undefined;
  }
}

async function renderPage(
  ctx: ProtectionContext,
  page: PdfPage,
  viewport: PdfViewport,
  factory: CanvasFactory,
): Promise<{ canvas: Canvas; png: Buffer }> {
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  if (
    width * height > ctx.limits.maxImagePixels ||
    width > ctx.limits.maxImageDimension ||
    height > ctx.limits.maxImageDimension
  ) {
    throw new SecurityError("Rendered PDF page exceeds image limits.");
  }
  const { canvas, context } = factory.create(width, height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  const task = page.render({
    canvasContext: context,
    canvas,
    viewport,
    intent: "print",
    annotationMode: 0,
  });
  await withTimeout("PDF rendering", task.promise, Math.max(1, ctx.deadline.remaining()), () =>
    task.cancel(),
  );
  return { canvas, png: await canvas.encode("png") };
}

function paintBoxes(canvas: Canvas, boxes: RedactionBox[]): void {
  const ctx = canvas.getContext("2d");
  for (const { box, label } of boxes) {
    ctx.fillStyle = "#000";
    ctx.fillRect(Math.floor(box.x), Math.floor(box.y), Math.ceil(box.width), Math.ceil(box.height));
    if (label) {
      // Shrink the label until it fits inside the box; skip it if it would be unreadable.
      let size = Math.floor(box.height * 0.7);
      ctx.font = `${size}px "DejaVu Sans", Arial, sans-serif`;
      while (size >= 7 && ctx.measureText(label).width > box.width - 4) {
        size--;
        ctx.font = `${size}px "DejaVu Sans", Arial, sans-serif`;
      }
      if (size >= 7) {
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, box.x + 2, box.y + box.height / 2);
      }
    }
  }
}

async function assemblePdf(
  pages: { png: Buffer; width: number; height: number }[],
): Promise<Buffer> {
  const { PDFDocument } = await optionalImport<PdfLib>("pdf-lib", "sanitized PDF output");
  const out = await PDFDocument.create();
  out.setProducer("ARAN");
  out.setCreator("ARAN");
  out.setTitle("");
  out.setAuthor("");
  out.setSubject("");
  out.setKeywords([]);
  for (const p of pages) {
    const img = await out.embedPng(p.png);
    out
      .addPage([p.width, p.height])
      .drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
  }
  return Buffer.from(await out.save({ useObjectStreams: true }));
}

/** OCR the redacted page images and flag any remaining sensitive text. */
async function verifyRedactions(ctx: ProtectionContext, pages: { png: Buffer }[]): Promise<void> {
  const ocr = await ctx.services.ocr();
  if (!ocr) {
    ctx.warn({
      code: "PDF_VERIFICATION_FAILED",
      message: "Redaction verification requires OCR, which is unavailable.",
      severity: "warning",
    });
    return;
  }
  for (let i = 0; i < pages.length; i++) {
    try {
      const result = await ctx.services.ocrSemaphore.run(() =>
        withTimeout("OCR", ocr.extract(pages[i]!.png), ctx.limits.ocrTimeoutMs),
      );
      const layout = layoutOcrText(result.words);
      const { entities } = await ctx.services.detection.detect({ text: layout.text });
      const policy = ctx.services.policy;
      const residual = entities.filter(
        (e) =>
          e.confidence >= policy.thresholdFor(e.type) &&
          policy.actionFor(e.type).action !== "allow",
      );
      if (residual.length > 0) {
        ctx.warn({
          code: "PDF_VERIFICATION_FAILED",
          message: `Verification found ${residual.length} possibly unredacted sensitive value(s) on a page.`,
          severity: "error",
          incomplete: true,
          page: i + 1,
        });
      }
    } catch {
      ctx.warn({
        code: "PDF_VERIFICATION_FAILED",
        message: "Redaction verification failed for a page.",
        severity: "warning",
        page: i + 1,
      });
    }
  }
}

function clampScale(scale: number): number {
  return Number.isFinite(scale) ? Math.max(0.5, Math.min(4, scale)) : 2;
}

function standardFontOptions(): Record<string, string> {
  try {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve("pdfjs-dist/package.json"));
    return {
      standardFontDataUrl: join(root, "standard_fonts") + sep,
      cMapUrl: join(root, "cmaps") + sep,
    };
  } catch {
    return {};
  }
}
