import { TimeoutError } from "../core/errors.js";

export interface Limits {
  /** Maximum text input size in bytes (UTF-8). */
  maxTextBytes: number;
  /** Maximum binary file size in bytes. */
  maxFileBytes: number;
  /** Maximum number of PDF pages processed. */
  maxPdfPages: number;
  /** Maximum image width or height in pixels. */
  maxImageDimension: number;
  /** Maximum total image pixels (width × height). */
  maxImagePixels: number;
  /** Maximum number of entries in a ZIP-based document. */
  maxZipEntries: number;
  /** Maximum total uncompressed size of a ZIP-based document. */
  maxUncompressedBytes: number;
  /** Maximum compression ratio for any ZIP entry (zip-bomb protection). */
  maxCompressionRatio: number;
  /** Maximum nesting depth for structured (object) text input. */
  maxObjectDepth: number;
  /** Maximum number of nodes visited in structured text input. */
  maxObjectNodes: number;
  /** Maximum number of entities processed per request. */
  maxEntities: number;
  /** Overall processing timeout per request, in milliseconds. */
  timeoutMs: number;
  /** Timeout for a single OCR call, in milliseconds. */
  ocrTimeoutMs: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxTextBytes: 10 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxPdfPages: 300,
  maxImageDimension: 16_384,
  maxImagePixels: 40_000_000,
  maxZipEntries: 2_000,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxObjectDepth: 64,
  maxObjectNodes: 100_000,
  maxEntities: 100_000,
  timeoutMs: 120_000,
  ocrTimeoutMs: 60_000,
});

export function resolveLimits(overrides: Partial<Limits> | undefined): Limits {
  const limits: Limits = { ...DEFAULT_LIMITS };
  if (!overrides) return limits;
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Limit "${key}" must be a positive finite number.`);
    }
    limits[key] = value;
  }
  return limits;
}

/**
 * Race a promise against a timeout. The optional `onTimeout` callback can
 * abort underlying work (e.g. terminate an OCR worker).
 */
export async function withTimeout<T>(
  operation: string,
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new TimeoutError(operation, timeoutMs));
      }
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Tracks a request-wide deadline so multi-step pipelines share one budget. */
export class Deadline {
  private readonly expiresAt: number;
  constructor(
    private readonly operation: string,
    private readonly timeoutMs: number,
  ) {
    this.expiresAt = Date.now() + timeoutMs;
  }

  remaining(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  check(): void {
    if (Date.now() > this.expiresAt) throw new TimeoutError(this.operation, this.timeoutMs);
  }

  run<T>(promise: Promise<T>, onTimeout?: () => void): Promise<T> {
    this.check();
    return withTimeout(this.operation, promise, Math.max(1, this.remaining()), onTimeout);
  }
}

/** Minimal bounded-concurrency semaphore for expensive work such as OCR. */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1)
      throw new RangeError("Concurrency must be a positive integer.");
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
