import type { ProtectionContext } from "../../core/pipeline.js";
import type { BoundingBox } from "../../entities/entity-types.js";
import {
  boxesForSpan,
  layoutOcrText,
  union,
  type OcrLayout,
  type OcrWord,
} from "../../ocr/ocr-engine.js";
import { withTimeout } from "../../security/limits.js";

export interface RedactionBox {
  box: BoundingBox;
  /** Token/marker drawn inside the box, if it fits. */
  label?: string;
}

export interface ImageInspection {
  /** Sanitized OCR text. */
  text: string;
  boxes: RedactionBox[];
  /** False if OCR could not run; content was not inspected. */
  inspected: boolean;
  words: OcrWord[];
}

export interface InspectOptions {
  page?: number;
  /** Ignore OCR words overlapping these regions (already covered by a text layer). */
  exclude?: BoundingBox[];
  /** Run the optional face detector (default true). */
  faces?: boolean;
}

const LOW_CONFIDENCE = 60;
const VERY_LOW_CONFIDENCE = 40;

/**
 * OCR an image, detect sensitive text, apply policy, and compute redaction
 * boxes. Shared by image, PDF (scanned pages) and DOCX (embedded images).
 */
export async function inspectImage(
  ctx: ProtectionContext,
  png: Buffer,
  options: InspectOptions = {},
): Promise<ImageInspection> {
  const page = options.page;
  const boxes: RedactionBox[] = [];
  const pageField = page !== undefined ? { page } : {};

  if (options.faces !== false) await detectFaces(ctx, png, boxes, page);

  const ocr = await ctx.services.ocr();
  if (!ocr) {
    ctx.warn({
      code: "OCR_UNAVAILABLE",
      message:
        `OCR is unavailable; text inside the image was not inspected. ${ctx.services.ocrUnavailableReason() ?? ""}`.trim(),
      severity: "error",
      incomplete: true,
      ...pageField,
    });
    return { text: "", boxes, inspected: false, words: [] };
  }

  let words: OcrWord[];
  let confidence: number;
  try {
    const result = await ctx.services.ocrSemaphore.run(() =>
      withTimeout(
        "OCR",
        ocr.extract(png),
        Math.min(ctx.limits.ocrTimeoutMs, Math.max(1, ctx.deadline.remaining())),
      ),
    );
    words = result.words;
    confidence = result.confidence;
  } catch {
    ctx.warn({
      code: "OCR_FAILED",
      message: "OCR failed; the image was not fully inspected.",
      severity: "error",
      incomplete: true,
      ...pageField,
    });
    return { text: "", boxes, inspected: false, words: [] };
  }

  if (options.exclude && options.exclude.length > 0) {
    const excluded = options.exclude;
    words = words.filter((w) => !excluded.some((b) => intersects(b, w.bbox)));
  }

  if (words.length > 0 && confidence < LOW_CONFIDENCE) {
    ctx.warn({
      code: "OCR_LOW_CONFIDENCE",
      message: "OCR confidence is low; some text in the image may not have been recognised.",
      severity: confidence < VERY_LOW_CONFIDENCE ? "error" : "warning",
      ...(confidence < VERY_LOW_CONFIDENCE ? { incomplete: true } : {}),
      ...pageField,
    });
  }

  const layout = layoutOcrText(words);
  const seg = await ctx.processText(layout.text, {
    ...pageField,
    locate: (e) => unionBox(boxesForSpan(layout, e.start, e.end)),
  });
  boxes.push(...boxesForEntities(layout, seg.entities, seg.replacements));
  return { text: seg.text, boxes, inspected: true, words };
}

export function boxesForEntities(
  layout: OcrLayout,
  entities: { entity: { id: string; start: number; end: number }; action: string }[],
  replacements: { entity: { id: string }; replacement: string }[],
): RedactionBox[] {
  const out: RedactionBox[] = [];
  for (const { entity, action } of entities) {
    if (action === "allow") continue;
    const label = replacements.find((r) => r.entity.id === entity.id)?.replacement;
    for (const box of boxesForSpan(layout, entity.start, entity.end, 3))
      out.push(label ? { box, label } : { box });
  }
  return out;
}

async function detectFaces(
  ctx: ProtectionContext,
  png: Buffer,
  boxes: RedactionBox[],
  page?: number,
): Promise<void> {
  const detector = ctx.services.faceDetector;
  if (!detector) {
    ctx.warn({
      code: "FACES_NOT_INSPECTED",
      message: "No face detector is configured; faces in images were not inspected.",
      severity: "info",
    });
    return;
  }
  try {
    const faces = await detector.detect(png);
    for (const face of faces) {
      const action = ctx.recordRegion("FACE", face.box, face.confidence, page);
      if (action !== "allow") boxes.push({ box: face.box, label: "[FACE_REDACTED]" });
    }
  } catch {
    ctx.warn({
      code: "DETECTOR_FAILED",
      message: "Face detector failed; faces were not inspected.",
      severity: "error",
      incomplete: true,
    });
  }
}

function unionBox(boxes: BoundingBox[]): BoundingBox | undefined {
  if (boxes.length === 0) return undefined;
  return boxes.reduce((acc, b) => union(acc, b));
}

export function intersects(a: BoundingBox, b: BoundingBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
