import { InputValidationError, SecurityError, UnsupportedFormatError } from "../core/errors.js";
import type { BinaryData, InputType } from "../types/input.js";
import type { Limits } from "./limits.js";

export type DetectedFormat =
  "png" | "jpeg" | "webp" | "tiff" | "gif" | "bmp" | "pdf" | "zip" | "ole" | "unknown";

const MIME_BY_FORMAT: Record<DetectedFormat, readonly string[]> = {
  png: ["image/png"],
  jpeg: ["image/jpeg", "image/jpg", "image/pjpeg"],
  webp: ["image/webp"],
  tiff: ["image/tiff", "image/tif"],
  gif: ["image/gif"],
  bmp: ["image/bmp"],
  pdf: ["application/pdf", "application/x-pdf"],
  zip: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/octet-stream",
  ],
  ole: ["application/msword"],
  unknown: [],
};

const EXTENSIONS_BY_FORMAT: Record<DetectedFormat, readonly string[]> = {
  png: ["png"],
  jpeg: ["jpg", "jpeg", "jpe", "jfif"],
  webp: ["webp"],
  tiff: ["tif", "tiff"],
  gif: ["gif"],
  bmp: ["bmp"],
  pdf: ["pdf"],
  zip: ["docx", "zip"],
  ole: ["doc"],
  unknown: [],
};

export const SUPPORTED_IMAGE_FORMATS: readonly DetectedFormat[] = ["png", "jpeg", "webp", "tiff"];

/** Identify a file by its magic bytes. Extensions and declared MIME types are never trusted. */
export function sniffFormat(bytes: Uint8Array): DetectedFormat {
  const b = (i: number): number => bytes[i] ?? -1;
  if (
    bytes.length >= 8 &&
    b(0) === 0x89 &&
    b(1) === 0x50 &&
    b(2) === 0x4e &&
    b(3) === 0x47 &&
    b(4) === 0x0d &&
    b(5) === 0x0a &&
    b(6) === 0x1a &&
    b(7) === 0x0a
  )
    return "png";
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "webp";
  if (
    bytes.length >= 4 &&
    ((b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2a && b(3) === 0x00) ||
      (b(0) === 0x4d && b(1) === 0x4d && b(2) === 0x00 && b(3) === 0x2a))
  )
    return "tiff";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a"))
    return "gif";
  if (bytes.length >= 2 && b(0) === 0x42 && b(1) === 0x4d) return "bmp";
  if (
    bytes.length >= 4 &&
    b(0) === 0x50 &&
    b(1) === 0x4b &&
    ((b(2) === 0x03 && b(3) === 0x04) || (b(2) === 0x05 && b(3) === 0x06))
  )
    return "zip";
  if (
    bytes.length >= 8 &&
    b(0) === 0xd0 &&
    b(1) === 0xcf &&
    b(2) === 0x11 &&
    b(3) === 0xe0 &&
    b(4) === 0xa1 &&
    b(5) === 0xb1 &&
    b(6) === 0x1a &&
    b(7) === 0xe1
  )
    return "ole";
  // PDF header may be preceded by up to 1024 bytes of junk per the spec.
  const head = ascii(bytes, 0, Math.min(bytes.length, 1024));
  if (head.includes("%PDF-")) return "pdf";
  return "unknown";
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = "";
  for (let i = start; i < start + length && i < bytes.length; i++)
    s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

export function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  throw new InputValidationError("File input data must be a Buffer, Uint8Array or ArrayBuffer.");
}

export interface ValidatedFile {
  buffer: Buffer;
  format: DetectedFormat;
}

/**
 * Validate binary input: size limit, magic bytes, and consistency of the
 * optional declared MIME type and filename extension with the actual content.
 */
export function validateFile(
  input: { type: InputType; data: BinaryData; filename?: string; mimeType?: string },
  limits: Limits,
): ValidatedFile {
  const buffer = toBuffer(input.data);
  if (buffer.length === 0) throw new InputValidationError("File input is empty.");
  if (buffer.length > limits.maxFileBytes) {
    throw new SecurityError("File exceeds the maximum allowed size.", {
      details: { size: buffer.length, limit: limits.maxFileBytes },
    });
  }

  const format = sniffFormat(buffer);
  const expected = expectedFormats(input.type);

  if (input.type === "docx" && format === "ole") {
    throw new UnsupportedFormatError(
      "Legacy binary .doc files are not supported. Convert the document to .docx first.",
      { details: { detectedFormat: "doc" } },
    );
  }
  if (!expected.includes(format)) {
    throw new UnsupportedFormatError(
      `File content does not match the declared input type "${input.type}".`,
      {
        details: { detectedFormat: format, inputType: input.type },
      },
    );
  }

  if (input.mimeType !== undefined) {
    const mime = input.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
    if (!MIME_BY_FORMAT[format].includes(mime)) {
      throw new InputValidationError("Declared MIME type does not match the file content.", {
        details: { detectedFormat: format },
      });
    }
  }

  if (input.filename !== undefined) {
    const ext = extensionOf(input.filename);
    if (ext !== "" && !EXTENSIONS_BY_FORMAT[format].includes(ext)) {
      throw new InputValidationError("File extension does not match the file content.", {
        details: { extension: ext, detectedFormat: format },
      });
    }
  }

  return { buffer, format };
}

function expectedFormats(type: InputType): readonly DetectedFormat[] {
  switch (type) {
    case "image":
      return SUPPORTED_IMAGE_FORMATS;
    case "pdf":
      return ["pdf"];
    case "docx":
      return ["zip"];
    case "text":
      return [];
  }
}

/** Lower-case extension without the dot. Only the final path segment is considered. */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Map a file extension to an ARAN input type (used by the CLI). */
export function inputTypeForExtension(ext: string): InputType | undefined {
  if (["png", "jpg", "jpeg", "webp", "tif", "tiff"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (["txt", "md", "json", "csv", "log", "yaml", "yml", "xml", "html", "eml"].includes(ext))
    return "text";
  return undefined;
}

/** Map sniffed content to an input type (used when no extension is available). */
export function inputTypeForFormat(format: DetectedFormat): InputType | undefined {
  if (SUPPORTED_IMAGE_FORMATS.includes(format)) return "image";
  if (format === "pdf") return "pdf";
  if (format === "zip" || format === "ole") return "docx";
  return undefined;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True for object keys that could cause prototype pollution if assigned naively. */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}
