/**
 * Typed ARAN errors.
 *
 * Error messages and `details` must never contain sensitive input values.
 * Underlying errors are not attached as `cause` because third-party parsers
 * (JSON, PDF, ZIP) may embed fragments of the input in their messages; only
 * the underlying error's class name is kept.
 */
export type AranErrorCode =
  | "ARAN_ERROR"
  | "DETECTION_ERROR"
  | "POLICY_ERROR"
  | "UNSUPPORTED_FORMAT"
  | "OCR_FAILURE"
  | "DOCUMENT_PROCESSING_ERROR"
  | "TOKENIZATION_ERROR"
  | "RESTORATION_ERROR"
  | "SECURITY_ERROR"
  | "INPUT_VALIDATION_ERROR"
  | "PROVIDER_ERROR"
  | "DEPENDENCY_MISSING"
  | "TIMEOUT"
  | "BLOCKED";

export type ErrorDetails = Readonly<Record<string, string | number | boolean | readonly string[]>>;

export interface AranErrorOptions {
  details?: ErrorDetails;
  /** Underlying error; only its class name is retained. */
  cause?: unknown;
}

export class AranError extends Error {
  readonly code: AranErrorCode;
  readonly details: ErrorDetails;
  readonly causeName: string | undefined;

  constructor(message: string, code: AranErrorCode = "ARAN_ERROR", options: AranErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.causeName = describeCause(options.cause);
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

export class DetectionError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "DETECTION_ERROR", options);
  }
}

export class PolicyError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "POLICY_ERROR", options);
  }
}

export class UnsupportedFormatError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "UNSUPPORTED_FORMAT", options);
  }
}

export class OCRFailureError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "OCR_FAILURE", options);
  }
}

export class DocumentProcessingError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "DOCUMENT_PROCESSING_ERROR", options);
  }
}

export class TokenizationError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "TOKENIZATION_ERROR", options);
  }
}

export class RestorationError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "RESTORATION_ERROR", options);
  }
}

export class SecurityError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "SECURITY_ERROR", options);
  }
}

export class InputValidationError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "INPUT_VALIDATION_ERROR", options);
  }
}

export class ProviderError extends AranError {
  readonly status: number | undefined;
  constructor(message: string, options?: AranErrorOptions & { status?: number }) {
    super(message, "PROVIDER_ERROR", options);
    this.status = options?.status;
  }
}

export class DependencyMissingError extends AranError {
  readonly dependency: string;
  constructor(dependency: string, feature: string) {
    super(
      `Optional dependency "${dependency}" is required for ${feature}. Install it with: npm install ${dependency}`,
      "DEPENDENCY_MISSING",
      { details: { dependency, feature } },
    );
    this.dependency = dependency;
  }
}

export class TimeoutError extends AranError {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} exceeded the ${timeoutMs}ms processing timeout.`, "TIMEOUT", {
      details: { operation, timeoutMs },
    });
  }
}

/** Raised by convenience APIs when a policy blocks a request or response. */
export class BlockedError extends AranError {
  constructor(message: string, options?: AranErrorOptions) {
    super(message, "BLOCKED", options);
  }
}

function describeCause(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) return cause.name;
  return typeof cause;
}
