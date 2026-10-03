import type { DetectedEntity, SpanEntity } from "../entities/entity.js";
import { toDetectedEntity } from "../entities/entity.js";
import type { EntityRegistry } from "../entities/entity-registry.js";
import type { BoundingBox, EntityType } from "../entities/entity-types.js";
import type { DetectionEngine } from "../detection/engine.js";
import { findTokenSpans } from "../detection/engine.js";
import { entityTypeForField } from "../detection/field-hints.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { ProtectionActionType } from "../policy/policy.js";
import type { Pseudonymizer } from "../protection/pseudonymizer.js";
import { applyReplacements, type Replacement } from "../protection/redactor.js";
import { redactionMarker, type Tokenizer } from "../protection/tokenizer.js";
import type { Deadline, Limits, Semaphore } from "../security/limits.js";
import type { OcrEngine } from "../ocr/ocr-engine.js";
import type { FaceDetector } from "../formats/image/face-detector.js";
import type { Auditor } from "../logging/audit.js";
import type { MinimizationReport, ProtectionAction, Warning } from "../types/output.js";
import type { Session } from "./context.js";

export interface AppliedReplacement extends Replacement {
  entity: SpanEntity;
  action: ProtectionActionType;
}

export interface SegmentResult {
  text: string;
  /** Replacements applied, in original-text offsets. Includes `allow` decisions with empty effect excluded. */
  replacements: AppliedReplacement[];
  /** Entities with their final decision, in original-text offsets. */
  entities: { entity: SpanEntity; action: ProtectionActionType }[];
}

export interface SegmentOptions {
  page?: number;
  fieldName?: string;
  /** Bounding box resolver for image/PDF entities. */
  locate?: (entity: SpanEntity) => BoundingBox | undefined;
}

export interface PipelineServices {
  detection: DetectionEngine;
  policy: PolicyEngine;
  registry: EntityRegistry;
  tokenizer: Tokenizer;
  pseudonymizer: Pseudonymizer;
  limits: Limits;
  ocr: () => Promise<OcrEngine | undefined>;
  ocrUnavailableReason: () => string | undefined;
  ocrSemaphore: Semaphore;
  faceDetector: FaceDetector | undefined;
  auditor: Auditor;
}

/**
 * Per-request state shared by all format handlers. Every text segment of a
 * request (a string, a JSON field, an OCR'd image, a PDF page, a DOCX part)
 * goes through `processText`, so detection, policy decisions, tokenization
 * and reporting are identical across formats.
 */
export class ProtectionContext {
  readonly warnings: Warning[] = [];
  readonly detected: DetectedEntity[] = [];
  readonly actions: ProtectionAction[] = [];
  private readonly minimizationParts: MinimizationReport[] = [];
  private entityCounter = 0;
  blocked = false;
  incomplete = false;

  constructor(
    readonly services: PipelineServices,
    readonly session: Session | undefined,
    readonly requestId: string,
    readonly deadline: Deadline,
    readonly mode: "protect" | "scan",
    readonly purpose: string | undefined,
    readonly language: string | undefined,
  ) {}

  get limits(): Limits {
    return this.services.limits;
  }

  warn(warning: Warning): void {
    if (warning.incomplete) this.incomplete = true;
    // Avoid flooding results with identical warnings (e.g. one per page).
    const duplicate = this.warnings.find(
      (w) => w.code === warning.code && w.message === warning.message && w.page === warning.page,
    );
    if (!duplicate) this.warnings.push(warning);
  }

  /** Detect, decide and (in protect mode) replace sensitive spans in one text segment. */
  async processText(text: string, options: SegmentOptions = {}): Promise<SegmentResult> {
    this.deadline.check();
    if (text.length === 0) return { text, replacements: [], entities: [] };

    const outcome = await this.deadline.run(
      this.services.detection.detect({
        text,
        ...(this.language !== undefined ? { language: this.language } : {}),
        ...(this.purpose !== undefined ? { purpose: this.purpose } : {}),
        ...(options.fieldName !== undefined ? { fieldName: options.fieldName } : {}),
      }),
    );
    for (const w of outcome.warnings)
      this.warn(options.page !== undefined ? { ...w, page: options.page } : w);

    let entities = outcome.entities;
    if (options.fieldName !== undefined)
      entities = this.applyFieldHint(text, options.fieldName, entities);

    const decision = this.services.policy.decide(entities, this.purpose);
    for (const w of decision.warnings) this.warn(w);
    this.minimizationParts.push(decision.minimization);

    const replacements: AppliedReplacement[] = [];
    const decided: SegmentResult["entities"] = [];
    for (const d of decision.decisions) {
      const entity: SpanEntity = { ...d.entity, id: `E${++this.entityCounter}` };
      if (options.page !== undefined) entity.page = options.page;
      const box = options.locate?.(entity);
      if (box) entity.boundingBox = box;
      this.detected.push(toDetectedEntity(entity, "input"));
      decided.push({ entity, action: d.action });

      if (d.action === "block") this.blocked = true;
      const replacement =
        this.mode === "protect"
          ? await this.replacementFor(entity, d.action, d.restorable, text)
          : undefined;
      const action: ProtectionAction = {
        entityId: entity.id,
        entityType: entity.type,
        action: d.action,
        reason: d.reason,
        restorable: d.restorable && (d.action === "tokenize" || d.action === "pseudonymize"),
      };
      if (replacement !== undefined) action.replacement = replacement;
      this.actions.push(action);
      this.services.auditor.emit({
        event: "ENTITY_PROTECTED",
        requestId: this.requestId,
        ...(this.session ? { sessionId: this.session.id } : {}),
        entityType: entity.type,
        action: d.action.toUpperCase(),
        confidence: entity.confidence,
        source: entity.source,
      });
      if (replacement !== undefined) {
        replacements.push({
          start: entity.start,
          end: entity.end,
          replacement,
          entity,
          action: d.action,
        });
      }
    }

    const out = this.mode === "protect" ? applyReplacements(text, replacements) : text;
    return { text: out, replacements, entities: decided };
  }

  /**
   * Record a non-text entity (e.g. a face) found by an image detector.
   * Returns the action to apply to the region.
   */
  recordRegion(
    type: EntityType,
    box: BoundingBox,
    confidence: number,
    page?: number,
  ): ProtectionActionType {
    const { action, reason } = this.services.policy.actionFor(
      type,
      this.services.policy.matchPurpose(this.purpose),
    );
    const entity = {
      id: `E${++this.entityCounter}`,
      type,
      confidence,
      source: "custom" as const,
      boundingBox: box,
      ...(page !== undefined ? { page } : {}),
    };
    this.detected.push(toDetectedEntity(entity, "input"));
    // Regions cannot be tokenized reversibly; anything other than allow/block is a redaction.
    const effective: ProtectionActionType =
      action === "allow" || action === "block" ? action : "redact";
    if (effective === "block") this.blocked = true;
    this.actions.push({
      entityId: entity.id,
      entityType: type,
      action: effective,
      reason,
      restorable: false,
    });
    return effective;
  }

  private async replacementFor(
    entity: SpanEntity,
    action: ProtectionActionType,
    restorable: boolean,
    text: string,
  ): Promise<string | undefined> {
    const value = text.slice(entity.start, entity.end);
    switch (action) {
      case "allow":
        return undefined;
      case "redact":
      case "block":
        return redactionMarker(entity.type);
      case "tokenize": {
        const session = this.requireSession();
        const { token, collisionAvoided } = await this.services.tokenizer.tokenize(
          session,
          entity.type,
          value,
          restorable,
        );
        if (collisionAvoided) {
          this.warn({
            code: "TOKEN_COLLISION_AVOIDED",
            message:
              "Input already contained ARAN-style tokens; new tokens were numbered to avoid collisions.",
            severity: "info",
          });
        }
        return token;
      }
      case "pseudonymize":
        return this.services.pseudonymizer.pseudonymize(
          this.requireSession(),
          entity.type,
          value,
          restorable,
        );
    }
  }

  private requireSession(): Session {
    if (!this.session) throw new Error("Internal error: protection without a session.");
    return this.session;
  }

  /** Reserve token-like strings already present in input so new tokens never collide with them. */
  reserveExistingTokens(text: string): void {
    if (!this.session) return;
    for (const span of findTokenSpans(text)) this.session.reserve(text.slice(span.start, span.end));
  }

  private applyFieldHint(text: string, fieldName: string, entities: SpanEntity[]): SpanEntity[] {
    const type = entityTypeForField(fieldName);
    if (!type) return entities;
    const trimmedStart = text.length - text.trimStart().length;
    const trimmedEnd = text.trimEnd().length;
    if (trimmedEnd <= trimmedStart || text.length > 2000) return entities;
    const covered = entities.reduce((sum, e) => sum + (e.end - e.start), 0);
    if (covered >= (trimmedEnd - trimmedStart) * 0.6) return entities;
    // The field name is strong evidence: treat the whole value as one entity.
    return [
      {
        id: "",
        type,
        start: trimmedStart,
        end: trimmedEnd,
        confidence: 0.9,
        source: "field",
        detector: "aran.field-hints",
      },
    ];
  }

  minimization(): MinimizationReport {
    const merge = (key: "removed" | "retained" | "tokenized" | "blocked"): EntityType[] => [
      ...new Set(this.minimizationParts.flatMap((m) => m[key])),
    ];
    const first = this.minimizationParts[0];
    const purposeRule = this.services.policy.matchPurpose(this.purpose);
    return {
      ...(this.purpose !== undefined ? { purpose: this.purpose } : {}),
      ...(purposeRule ? { matchedRule: purposeRule.id } : {}),
      reason:
        first?.reason ??
        (purposeRule
          ? `Purpose matched rule "${purposeRule.id}"`
          : this.purpose
            ? "No purpose rule matched; base policy applied."
            : "No purpose provided; base policy applied."),
      removed: merge("removed"),
      retained: merge("retained"),
      tokenized: merge("tokenized"),
      blocked: merge("blocked"),
    };
  }
}
