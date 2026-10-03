import type { Detector } from "../detection/detector.js";
import type { FaceDetector } from "../formats/image/face-detector.js";
import type { AuditSink } from "../logging/audit.js";
import type { LogLevel, Logger } from "../logging/logger.js";
import type { OcrEngine } from "../ocr/ocr-engine.js";
import type { TesseractEngineOptions } from "../ocr/tesseract-engine.js";
import type { FailMode, Policy, PolicyInput } from "../policy/policy.js";
import type { MappingStore } from "../restoration/mapping-store.js";
import type { Limits } from "../security/limits.js";

/**
 * - `balanced` (default): uses the policy's fail mode and thresholds.
 * - `strict`: forces fail-closed, lowers the detection threshold to at most
 *   0.35, and verifies redacted PDFs with OCR when available.
 */
export type AranMode = "balanced" | "strict";

/**
 * - `session` (default): mappings live until the session expires or is destroyed.
 * - `zero`: mappings are destroyed immediately after `release()`/`restore()`.
 */
export type RetentionMode = "session" | "zero";

export interface PdfOptions {
  /** OCR policy for PDF pages: `auto` OCRs pages with little text or embedded images. */
  ocr?: "auto" | "always" | "never";
  /** Render scale for OCR and document mode (default 2 ≈ 144 DPI). */
  renderScale?: number;
  /** Re-OCR redacted pages in document mode and flag residual sensitive text. */
  verify?: boolean;
}

export interface DocxOptions {
  /** OCR and redact embedded PNG/JPEG images (requires OCR + sharp). Default true. */
  inspectImages?: boolean;
}

export interface AranOptions {
  /** Built-in policy name, a policy definition, or an entity → action shorthand. Default "default". */
  policy?: PolicyInput | Policy;
  mode?: AranMode;
  /** Overrides the policy's fail mode. */
  failMode?: FailMode;
  /** Overrides the policy's minimum detection confidence. */
  minConfidence?: number;
  /**
   * Token mapping storage: `memory` (default), `encrypted-memory`
   * (AES-256-GCM with a per-instance key), or a custom MappingStore
   * (wrapped with encryption when `encryptionKey` is given).
   */
  mappingStore?: "memory" | "encrypted-memory" | MappingStore;
  /** 32-byte key (Buffer, hex or base64) for encrypted mapping storage. */
  encryptionKey?: Buffer | Uint8Array | string;
  retention?: RetentionMode;
  /** Session lifetime in milliseconds (default 1 hour). */
  sessionTtlMs?: number;
  /** Additional detectors (e.g. an ML-based NER adapter). */
  detectors?: Detector[];
  /** Names of built-in detectors to disable: "aran.pii", "aran.secrets", "aran.ner-heuristic". */
  disableDetectors?: string[];
  /** OCR engine, Tesseract options, or `false` to disable OCR. */
  ocr?: OcrEngine | TesseractEngineOptions | false;
  faceDetector?: FaceDetector;
  pdf?: PdfOptions;
  docx?: DocxOptions;
  limits?: Partial<Limits>;
  /** Max concurrent OCR jobs per Aran instance (default 2). */
  concurrency?: number;
  /** Default language hint (BCP-47). */
  language?: string;
  /** Custom logger, or `false` to disable logging. Fields are always sanitized. */
  logger?: Logger | false;
  /** Level for the built-in console logger (default "warn"). */
  logLevel?: LogLevel;
  audit?: AuditSink;
}
