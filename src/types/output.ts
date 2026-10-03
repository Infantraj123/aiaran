import type { DetectedEntity } from "../entities/entity.js";
import type { EntityType } from "../entities/entity-types.js";
import type { OutputActionType, ProtectionActionType } from "../policy/policy.js";
import type {
  DocxInput,
  ImageInput,
  InputType,
  PdfInput,
  ProtectInput,
  TextInput,
} from "./input.js";

/**
 * - `safe`: all content was inspected and protected according to policy.
 * - `uncertain`: some content could not be fully inspected (e.g. OCR failed).
 *    In fail-closed mode `safeData` is withheld (null).
 * - `blocked`: the policy blocked the request; `safeData` is null.
 */
export type ProtectionStatus = "safe" | "uncertain" | "blocked";

export type RiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type WarningCode =
  | "OCR_FAILED"
  | "OCR_UNAVAILABLE"
  | "OCR_LOW_CONFIDENCE"
  | "FACES_NOT_INSPECTED"
  | "PDF_SCANNED_PAGE"
  | "PDF_PAGE_FAILED"
  | "PDF_RENDER_UNAVAILABLE"
  | "PDF_DOCUMENT_MODE_FAILED"
  | "PDF_VERIFICATION_FAILED"
  | "PDF_ENCRYPTED"
  | "DOCUMENT_STRUCTURE_UNSUPPORTED"
  | "EMBEDDED_MEDIA_NOT_INSPECTED"
  | "METADATA_REMOVED"
  | "DETECTOR_FAILED"
  | "ENTITY_LIMIT_REACHED"
  | "TOKEN_COLLISION_AVOIDED"
  | "LOW_CONFIDENCE_ENTITY"
  | "NO_SESSION"
  | "UNKNOWN_TOKEN"
  | "TOKEN_NOT_RESTORABLE"
  | "OUTPUT_SENSITIVE_DATA"
  | "PURPOSE_NOT_MATCHED"
  | "FAIL_CLOSED_WITHHELD";

export interface Warning {
  code: WarningCode;
  /** Human-readable message. Never contains sensitive values. */
  message: string;
  severity: "info" | "warning" | "error";
  page?: number;
  /** True if this warning means content was not fully inspected. */
  incomplete?: boolean;
}

export interface ProtectionAction {
  entityId: string;
  entityType: EntityType;
  action: ProtectionActionType;
  /** Replacement placed in the safe payload (a token or redaction marker — never the original). */
  replacement?: string;
  /** Why this action was chosen. */
  reason: "policy" | "default" | "purpose";
  /** Whether the replacement can be restored to the original in AI output. */
  restorable: boolean;
}

export interface MinimizationReport {
  purpose?: string;
  /** ID of the purpose rule that matched, if any. */
  matchedRule?: string;
  reason: string;
  /** Entity types removed from the payload (redacted). */
  removed: EntityType[];
  /** Entity types sent to the AI unchanged. */
  retained: EntityType[];
  /** Entity types replaced with reversible tokens or pseudonyms. */
  tokenized: EntityType[];
  /** Entity types that caused the request to be blocked. */
  blocked: EntityType[];
}

export interface ProtectionSummary {
  total: number;
  counts: Partial<Record<EntityType, number>>;
  riskLevel: RiskLevel;
}

export interface SafePage {
  page: number;
  text: string;
  /** How the page text was obtained. */
  source: "text" | "ocr";
}

export interface ImageSafeData {
  /** Redacted image (PNG). Metadata such as EXIF/GPS is stripped. */
  image: Buffer;
  mimeType: "image/png";
  /** Sanitized OCR text. */
  text: string;
}

export interface DocumentSafeData {
  /** Sanitized text content. */
  text: string;
  /** Per-page sanitized text (PDF only). */
  pages?: SafePage[];
  /** Sanitized document (document mode only). */
  document?: Buffer;
  mimeType?: string;
}

export type TextSafeData = string | Record<string, unknown> | unknown[];

export type SafeDataFor<I extends ProtectInput> = I extends TextInput
  ? I["data"] extends string
    ? string
    : TextSafeData
  : I extends ImageInput
    ? ImageSafeData
    : I extends PdfInput | DocxInput
      ? DocumentSafeData
      : never;

export type SafeData = TextSafeData | ImageSafeData | DocumentSafeData;

export interface ProtectionResult<T = SafeData> {
  sessionId: string;
  requestId: string;
  type: InputType;
  status: ProtectionStatus;
  /** The protected payload that is safe to send to an AI model, or null if blocked/withheld. */
  safeData: T | null;
  /** Alias of `safeData`. */
  protectedData: T | null;
  detectedEntities: DetectedEntity[];
  actions: ProtectionAction[];
  warnings: Warning[];
  minimization: MinimizationReport;
  summary: ProtectionSummary;
  policy: string;
  metadata: {
    processingTimeMs: number;
    detectorVersions: Record<string, string>;
    failMode: "open" | "closed";
    language?: string;
    pages?: number;
  };
}

export interface ScanResult {
  requestId: string;
  type: InputType;
  status: "complete" | "incomplete";
  detectedEntities: DetectedEntity[];
  warnings: Warning[];
  summary: ProtectionSummary;
  metadata: {
    processingTimeMs: number;
    detectorVersions: Record<string, string>;
    pages?: number;
  };
}

export interface OutputAction {
  entityId: string;
  entityType: EntityType;
  action: OutputActionType;
  replacement?: string;
}

export interface ReleaseResult {
  sessionId?: string;
  requestId: string;
  /** `blocked` means the output policy withheld the response (`data` is null). */
  status: "safe" | "warned" | "blocked";
  data: string | null;
  restoredTokens: number;
  /** Tokens present in the output that were not restored (unknown or not restorable). */
  unrestoredTokens: number;
  detectedEntities: DetectedEntity[];
  actions: OutputAction[];
  warnings: Warning[];
  metadata: { processingTimeMs: number };
}
