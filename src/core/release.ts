import { InputValidationError, SecurityError } from "./errors.js";
import type { Session } from "./context.js";
import type { DetectionEngine } from "../detection/engine.js";
import { toDetectedEntity, type SpanEntity } from "../entities/entity.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { OutputActionType } from "../policy/policy.js";
import type { Tokenizer } from "../protection/tokenizer.js";
import { redactionMarker } from "../protection/tokenizer.js";
import { applyReplacements, type Replacement } from "../protection/redactor.js";
import type { Restorer } from "../restoration/restorer.js";
import type { Auditor } from "../logging/audit.js";
import type { OutputAction, ReleaseResult, Warning } from "../types/output.js";

export interface ReleaseServices {
  detection: DetectionEngine;
  policy: PolicyEngine;
  tokenizer: Tokenizer;
  restorer: Restorer;
  auditor: Auditor;
  maxTextBytes: number;
}

/**
 * Output pipeline: scan the AI response for sensitive values that ARAN did
 * not place there, apply the output policy, then restore permitted tokens.
 * Restoration runs last so restored originals are never mistaken for leaks.
 */
export async function releaseText(
  services: ReleaseServices,
  text: string,
  session: Session | undefined,
  requestId: string,
  missingSessionId: boolean,
): Promise<Omit<ReleaseResult, "metadata">> {
  if (typeof text !== "string")
    throw new InputValidationError("AI response text must be a string.");
  if (Buffer.byteLength(text, "utf8") > services.maxTextBytes) {
    throw new SecurityError("AI response exceeds the maximum allowed size.", {
      details: { limit: services.maxTextBytes },
    });
  }
  const warnings: Warning[] = [];
  if (missingSessionId) {
    warnings.push({
      code: "NO_SESSION",
      message:
        "No active session for this response (unknown, expired or destroyed); tokens were not restored.",
      severity: "warning",
    });
  }

  const outcome = await services.detection.detect({ text });
  warnings.push(...outcome.warnings);

  // Pseudonyms placed by ARAN are expected in the output.
  const pseudoSpans: { start: number; end: number }[] = [];
  if (session) {
    for (const pseudo of session.pseudonyms.keys()) {
      let idx = text.indexOf(pseudo);
      while (idx !== -1) {
        pseudoSpans.push({ start: idx, end: idx + pseudo.length });
        idx = text.indexOf(pseudo, idx + pseudo.length);
      }
    }
  }

  const policy = services.policy;
  const unexpected: { entity: SpanEntity; action: OutputActionType }[] = [];
  for (const entity of outcome.entities) {
    if (entity.confidence < policy.thresholdFor(entity.type)) continue;
    if (pseudoSpans.some((s) => entity.start < s.end && s.start < entity.end)) continue;
    // Types the policy allows in input are not treated as leaks in output.
    const inputAction = policy.actionFor(entity.type).action;
    const action: OutputActionType =
      inputAction === "allow" ? "allow" : policy.outputActionFor(entity.type);
    if (action === "allow") continue;
    unexpected.push({ entity, action });
  }

  const actions: OutputAction[] = [];
  const replacements: Replacement[] = [];
  let blocked = false;
  let warned = false;
  for (const { entity, action } of unexpected) {
    const record: OutputAction = { entityId: entity.id, entityType: entity.type, action };
    if (action === "block") blocked = true;
    if (action === "warn") warned = true;
    if (action === "redact" || (action === "tokenize" && !session)) {
      record.replacement = redactionMarker(entity.type);
      replacements.push({ start: entity.start, end: entity.end, replacement: record.replacement });
    } else if (action === "tokenize" && session) {
      const { token } = await services.tokenizer.tokenize(
        session,
        entity.type,
        text.slice(entity.start, entity.end),
        false,
      );
      record.replacement = token;
      replacements.push({ start: entity.start, end: entity.end, replacement: token });
    }
    actions.push(record);
    services.auditor.emit({
      event: "OUTPUT_ENTITY_DETECTED",
      requestId,
      ...(session ? { sessionId: session.id } : {}),
      entityType: entity.type,
      action: action.toUpperCase(),
      confidence: entity.confidence,
      source: entity.source,
    });
  }
  if (unexpected.length > 0) {
    warnings.push({
      code: "OUTPUT_SENSITIVE_DATA",
      message: `AI output contained ${unexpected.length} sensitive value(s) not placed by ARAN; output policy applied.`,
      severity: blocked ? "error" : "warning",
    });
  }

  const detectedEntities = unexpected.map(({ entity }) => toDetectedEntity(entity, "output"));

  if (blocked) {
    services.auditor.emit({
      event: "OUTPUT_BLOCKED",
      requestId,
      ...(session ? { sessionId: session.id } : {}),
      count: unexpected.length,
    });
    return {
      ...(session ? { sessionId: session.id } : {}),
      requestId,
      status: "blocked",
      data: null,
      restoredTokens: 0,
      unrestoredTokens: 0,
      detectedEntities,
      actions,
      warnings,
    };
  }

  let data = applyReplacements(text, replacements);
  let restoredTokens = 0;
  let unrestoredTokens = 0;
  if (session && policy.policy.output.restoreTokens) {
    const restored = await services.restorer.restore(data, session);
    data = restored.text;
    restoredTokens = restored.restored;
    unrestoredTokens = restored.unrestored;
    warnings.push(...restored.warnings);
    if (restoredTokens > 0) {
      services.auditor.emit({
        event: "TOKENS_RESTORED",
        requestId,
        sessionId: session.id,
        count: restoredTokens,
      });
    }
  }

  return {
    ...(session ? { sessionId: session.id } : {}),
    requestId,
    status: warned ? "warned" : "safe",
    data,
    restoredTokens,
    unrestoredTokens,
    detectedEntities,
    actions,
    warnings,
  };
}
