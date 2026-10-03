import { DocumentProcessingError, SecurityError } from "../../core/errors.js";
import { optionalImport } from "../../core/optional.js";
import type { ProtectionContext } from "../../core/pipeline.js";
import type { Limits } from "../../security/limits.js";
import type { ImageSafeData } from "../../types/output.js";
import { inspectImage, type RedactionBox } from "./image-ocr.js";

interface SharpInstance {
  metadata(): Promise<{ width?: number; height?: number; pages?: number; format?: string }>;
  rotate(): SharpInstance;
  png(options?: Record<string, unknown>): SharpInstance;
  jpeg(options?: Record<string, unknown>): SharpInstance;
  composite(images: { input: Buffer; top: number; left: number }[]): SharpInstance;
  toBuffer(options: {
    resolveWithObject: true;
  }): Promise<{ data: Buffer; info: { width: number; height: number } }>;
  toBuffer(): Promise<Buffer>;
}
type SharpFactory = (input: Buffer, options?: Record<string, unknown>) => SharpInstance;

export async function loadSharp(): Promise<SharpFactory> {
  const mod = await optionalImport<SharpFactory | { default: SharpFactory }>(
    "sharp",
    "image processing",
  );
  return typeof mod === "function" ? mod : mod.default;
}

export function sharpOptions(limits: Limits): Record<string, unknown> {
  return {
    limitInputPixels: limits.maxImagePixels,
    failOn: "error",
    sequentialRead: true,
    animated: false,
  };
}

export interface NormalizedImage {
  png: Buffer;
  width: number;
  height: number;
  format: string;
}

/**
 * Decode and validate an image, apply EXIF orientation, and re-encode as
 * PNG. Re-encoding drops all metadata (EXIF, GPS, XMP, ICC comments).
 */
export async function normalizeImage(
  ctx: ProtectionContext,
  buffer: Buffer,
): Promise<NormalizedImage> {
  const sharp = await loadSharp();
  let meta: Awaited<ReturnType<SharpInstance["metadata"]>>;
  try {
    meta = await sharp(buffer, sharpOptions(ctx.limits)).metadata();
  } catch (error) {
    throw new DocumentProcessingError("Image could not be decoded.", { cause: error });
  }
  const { width = 0, height = 0 } = meta;
  if (width <= 0 || height <= 0) throw new DocumentProcessingError("Image has invalid dimensions.");
  if (
    width > ctx.limits.maxImageDimension ||
    height > ctx.limits.maxImageDimension ||
    width * height > ctx.limits.maxImagePixels
  ) {
    throw new SecurityError("Image dimensions exceed the configured limits.", {
      details: {
        width,
        height,
        maxDimension: ctx.limits.maxImageDimension,
        maxPixels: ctx.limits.maxImagePixels,
      },
    });
  }
  if ((meta.pages ?? 1) > 1) {
    ctx.warn({
      code: "DOCUMENT_STRUCTURE_UNSUPPORTED",
      message: "Image has multiple frames/pages; only the first was inspected and returned.",
      severity: "warning",
      incomplete: true,
    });
  }
  try {
    const { data, info } = await sharp(buffer, sharpOptions(ctx.limits))
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    return { png: data, width: info.width, height: info.height, format: meta.format ?? "unknown" };
  } catch (error) {
    throw new DocumentProcessingError("Image could not be decoded.", { cause: error });
  }
}

/** Draw opaque boxes (with optional token labels) over an image. */
export async function drawRedactions(
  ctx: ProtectionContext,
  image: Buffer,
  width: number,
  height: number,
  boxes: RedactionBox[],
  format: "png" | "jpeg" = "png",
): Promise<Buffer> {
  const sharp = await loadSharp();
  let pipeline = sharp(image, sharpOptions(ctx.limits));
  if (boxes.length > 0)
    pipeline = pipeline.composite([
      { input: Buffer.from(redactionSvg(width, height, boxes)), top: 0, left: 0 },
    ]);
  return format === "jpeg" ? pipeline.jpeg({ quality: 90 }).toBuffer() : pipeline.png().toBuffer();
}

export function redactionSvg(width: number, height: number, boxes: RedactionBox[]): string {
  const parts: string[] = [];
  for (const { box, label } of boxes) {
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const w = Math.max(1, Math.min(width - x, Math.ceil(box.width)));
    const h = Math.max(1, Math.min(height - y, Math.ceil(box.height)));
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>`);
    if (label) {
      const size = Math.floor(Math.min(h * 0.7, w / (label.length * 0.62)));
      if (size >= 7) {
        parts.push(
          `<text x="${x + 2}" y="${y + h / 2}" dominant-baseline="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" fill="#fff">${escapeXml(label)}</text>`,
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );
}

export async function processImageInput(
  ctx: ProtectionContext,
  buffer: Buffer,
): Promise<ImageSafeData | null> {
  const image = await normalizeImage(ctx, buffer);
  const inspection = await inspectImage(ctx, image.png);
  if (ctx.mode === "scan") return null;
  const redacted = await drawRedactions(
    ctx,
    image.png,
    image.width,
    image.height,
    inspection.boxes,
  );
  return { image: redacted, mimeType: "image/png", text: inspection.text };
}
