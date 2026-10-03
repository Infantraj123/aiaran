import type { EntityType } from "../entities/entity-types.js";

/**
 * Structured audit events. Audit events never include original values,
 * tokens-to-value mappings, prompts, responses or document contents.
 */
export type AuditEventName =
  | "SESSION_CREATED"
  | "SESSION_DESTROYED"
  | "ENTITY_PROTECTED"
  | "REQUEST_BLOCKED"
  | "REQUEST_UNCERTAIN"
  | "REQUEST_PROTECTED"
  | "OUTPUT_ENTITY_DETECTED"
  | "OUTPUT_BLOCKED"
  | "TOKENS_RESTORED";

export interface AuditEvent {
  event: AuditEventName;
  timestamp: string;
  requestId?: string;
  sessionId?: string;
  entityType?: EntityType;
  action?: string;
  confidence?: number;
  source?: string;
  count?: number;
  inputType?: string;
  policy?: string;
  reason?: string;
}

export type AuditSink = (event: AuditEvent) => void | Promise<void>;

export class Auditor {
  constructor(private readonly sink: AuditSink | undefined) {}

  get enabled(): boolean {
    return this.sink !== undefined;
  }

  emit(event: Omit<AuditEvent, "timestamp">): void {
    if (!this.sink) return;
    const full: AuditEvent = { ...event, timestamp: new Date().toISOString() };
    try {
      const result = this.sink(full);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          /* audit sinks must not break processing */
        });
      }
    } catch {
      /* audit sinks must not break processing */
    }
  }
}
