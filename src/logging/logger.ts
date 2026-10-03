/**
 * Privacy-safe logging.
 *
 * Every log call passes through `sanitizeFields`, which keeps only an
 * allowlist of non-sensitive keys (IDs, counts, timings, names) and drops
 * everything else. Raw prompts, responses, entity values, token mappings
 * and document contents can therefore never be logged by ARAN, even by
 * mistake.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SAFE_KEYS = new Set([
  "requestId",
  "sessionId",
  "inputType",
  "policy",
  "provider",
  "model",
  "status",
  "processingTimeMs",
  "durationMs",
  "entityCounts",
  "entityTotal",
  "riskLevel",
  "warningCodes",
  "pages",
  "detector",
  "errorCode",
  "errorName",
  "restoredTokens",
  "unrestoredTokens",
  "mode",
  "failMode",
  "action",
  "entityType",
  "count",
]);

/** Keep only allowlisted keys whose values are primitives or count maps. */
export function sanitizeFields(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_KEYS.has(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string")
      out[key] = value.length > 128 ? `${value.slice(0, 128)}…` : value;
    else if (Array.isArray(value))
      out[key] = value.filter((v) => typeof v === "string" || typeof v === "number");
    else if (value && typeof value === "object") {
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(value)) if (typeof v === "number") counts[k] = v;
      out[key] = counts;
    }
  }
  return out;
}

export class ConsoleLogger implements Logger {
  private readonly threshold: number;

  constructor(level: LogLevel = "warn") {
    this.threshold = LEVELS[level];
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  private write(level: Exclude<LogLevel, "silent">, message: string, fields?: LogFields): void {
    if (LEVELS[level] < this.threshold) return;
    const safe = sanitizeFields(fields);
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      msg: `[aran] ${message}`,
      ...safe,
    });
    // stderr keeps stdout clean for applications and the CLI.
    console.error(line);
  }
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Wraps a user-supplied logger so that it also only receives sanitized fields. */
export class SafeLogger implements Logger {
  constructor(private readonly inner: Logger) {}
  debug(message: string, fields?: LogFields): void {
    this.inner.debug(message, sanitizeFields(fields));
  }
  info(message: string, fields?: LogFields): void {
    this.inner.info(message, sanitizeFields(fields));
  }
  warn(message: string, fields?: LogFields): void {
    this.inner.warn(message, sanitizeFields(fields));
  }
  error(message: string, fields?: LogFields): void {
    this.inner.error(message, sanitizeFields(fields));
  }
}
