import { DetectionEngine } from "../detection/engine.js";
import type { Detector } from "../detection/detector.js";
import { guessLanguage } from "../detection/detector.js";
import { createPiiDetector } from "../detection/pii-detector.js";
import { createSecretDetector } from "../detection/secret-detector.js";
import { HeuristicNerDetector } from "../detection/ner-detector.js";
import { EntityRegistry } from "../entities/entity-registry.js";
import { processDocxInput } from "../formats/office/docx-handler.js";
import { processImageInput } from "../formats/image/image-handler.js";
import { processPdfInput } from "../formats/pdf/pdf-handler.js";
import { processTextInput } from "../formats/text/text-handler.js";
import { Auditor } from "../logging/audit.js";
import { ConsoleLogger, SafeLogger, silentLogger, type Logger } from "../logging/logger.js";
import type { OcrEngine } from "../ocr/ocr-engine.js";
import { TesseractEngine, type TesseractEngineOptions } from "../ocr/tesseract-engine.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { resolvePolicy } from "../policy/policy-loader.js";
import type { FailMode, Policy } from "../policy/policy.js";
import { EncryptedMappingStore } from "../protection/encryption.js";
import { Pseudonymizer } from "../protection/pseudonymizer.js";
import { Tokenizer } from "../protection/tokenizer.js";
import type { AIContentPart, AIProvider, AIRequest, AIResponse } from "../providers/provider.js";
import { MemoryMappingStore, type MappingStore } from "../restoration/mapping-store.js";
import { Restorer } from "../restoration/restorer.js";
import { randomId } from "../security/hashing.js";
import { Deadline, resolveLimits, Semaphore, type Limits } from "../security/limits.js";
import { validateFile } from "../security/validation.js";
import type { AranOptions } from "../types/configuration.js";
import type { ProtectInput } from "../types/input.js";
import type {
  DocumentSafeData,
  ImageSafeData,
  ProtectionResult,
  ReleaseResult,
  SafeData,
  SafeDataFor,
  ScanResult,
} from "../types/output.js";
import { SessionManager, type Session } from "./context.js";
import {
  AranError,
  BlockedError,
  InputValidationError,
  RestorationError,
  SecurityError,
} from "./errors.js";
import { ProtectionContext, type PipelineServices } from "./pipeline.js";
import { releaseText } from "./release.js";
import { summarize } from "./summary.js";

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
const TOKEN_HINT =
  "Some values in the user content were replaced with placeholders such as [PERSON_001] or [EMAIL_REDACTED]. " +
  "Treat each placeholder as an opaque value and reproduce placeholders exactly as written when you refer to them.";

export interface GenerateOptions {
  model?: string;
  /** System instructions (not scanned; must not contain sensitive data). */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Add an instruction asking the model to keep placeholders intact (default true). */
  tokenHint?: boolean;
  /** Proceed when protection status is "uncertain" in fail-open mode (default true). */
  allowUncertain?: boolean;
  signal?: AbortSignal;
}

export interface GenerateResult {
  /** Released (scanned and restored) response text, or null if output was blocked. */
  text: string | null;
  protection: ProtectionResult;
  release: ReleaseResult;
  response: Omit<AIResponse, "text">;
}

/**
 * ARAN privacy layer. Create one instance per policy configuration and reuse
 * it; sessions isolate token mappings between requests/users.
 */
export class Aran {
  readonly entities: EntityRegistry;
  readonly policy: Policy;
  readonly failMode: FailMode;
  private readonly limits: Limits;
  private readonly store: MappingStore;
  private readonly sessions: SessionManager;
  private readonly detection: DetectionEngine;
  private readonly policyEngine: PolicyEngine;
  private readonly tokenizer: Tokenizer;
  private readonly pseudonymizer: Pseudonymizer;
  private readonly restorer: Restorer;
  private readonly logger: Logger;
  private readonly auditor: Auditor;
  private readonly builtInDetectors: Detector[];
  private readonly extraDetectors: Detector[];
  private readonly ocrSemaphore: Semaphore;
  private ocrEngine: OcrEngine | undefined;
  private ocrInit: Promise<OcrEngine | undefined> | undefined;
  private ocrError: string | undefined;
  private disposed = false;

  constructor(private readonly options: AranOptions = {}) {
    this.limits = resolveLimits(options.limits);
    this.entities = new EntityRegistry();
    this.policy = resolvePolicy(options.policy, new Set(this.entities.list().map((e) => e.name)));
    const strict = options.mode === "strict";
    this.failMode = options.failMode ?? (strict ? "closed" : this.policy.failMode);
    const minConfidence =
      options.minConfidence ?? (strict ? Math.min(this.policy.minConfidence, 0.35) : undefined);
    if (minConfidence !== undefined && (minConfidence < 0 || minConfidence > 1)) {
      throw new InputValidationError("minConfidence must be between 0 and 1.");
    }

    const ttl = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.store = createStore(options);
    this.sessions = new SessionManager(this.store, ttl);
    this.tokenizer = new Tokenizer(this.store, ttl);
    this.pseudonymizer = new Pseudonymizer(this.store, ttl);
    this.restorer = new Restorer(this.store);

    const disabled = new Set(options.disableDetectors ?? []);
    this.builtInDetectors = [
      createPiiDetector(),
      createSecretDetector(),
      new HeuristicNerDetector(),
    ].filter((d) => !disabled.has(d.name));
    this.extraDetectors = [...(options.detectors ?? [])];
    this.detection = new DetectionEngine(
      () => [...this.builtInDetectors, ...this.extraDetectors, ...this.entities.detectors()],
      this.entities,
      this.limits.maxEntities,
    );
    this.policyEngine = new PolicyEngine(this.policy, this.entities, minConfidence);

    this.logger =
      options.logger === false
        ? silentLogger
        : options.logger
          ? new SafeLogger(options.logger)
          : new ConsoleLogger(options.logLevel ?? "warn");
    this.auditor = new Auditor(options.audit);
    this.ocrSemaphore = new Semaphore(options.concurrency ?? 2);
    if (options.ocr && "extract" in options.ocr) this.ocrEngine = options.ocr;
  }

  /** Register an additional detector (e.g. an ML-backed NER adapter). */
  addDetector(detector: Detector): this {
    this.extraDetectors.push(detector);
    return this;
  }

  /**
   * Detect and protect sensitive data. The returned `safeData` is the only
   * payload that should be sent to an AI provider.
   */
  async protect<I extends ProtectInput>(input: I): Promise<ProtectionResult<SafeDataFor<I>>> {
    this.assertUsable();
    const started = performance.now();
    validateInputShape(input);
    const requestId = `req_${randomId(12)}`;

    let session: Session;
    if (input.sessionId !== undefined) {
      const existing = this.sessions.get(input.sessionId);
      if (!existing)
        throw new InputValidationError("Unknown or expired session.", {
          details: { reason: "session" },
        });
      session = existing;
      await this.sessions.touch(session);
    } else {
      session = this.sessions.create();
      this.auditor.emit({ event: "SESSION_CREATED", requestId, sessionId: session.id });
    }

    const ctx = this.createContext(input, session, requestId, "protect");
    let safeData: SafeData | null;
    let pages: number | undefined;
    try {
      ({ safeData, pages } = await this.dispatch(ctx, input));
    } catch (error) {
      // A brand-new session must not leak mappings if processing failed midway.
      if (input.sessionId === undefined) await this.sessions.destroy(session.id);
      throw error;
    }

    let status: ProtectionResult["status"] = "safe";
    if (ctx.blocked) status = "blocked";
    else if (ctx.incomplete) status = "uncertain";

    if (status === "blocked") {
      safeData = null;
      this.auditor.emit({
        event: "REQUEST_BLOCKED",
        requestId,
        sessionId: session.id,
        inputType: input.type,
        policy: this.policy.name,
      });
    } else if (status === "uncertain") {
      this.auditor.emit({
        event: "REQUEST_UNCERTAIN",
        requestId,
        sessionId: session.id,
        inputType: input.type,
        policy: this.policy.name,
      });
      if (this.failMode === "closed") {
        safeData = null;
        ctx.warn({
          code: "FAIL_CLOSED_WITHHELD",
          message:
            "Content could not be fully inspected; protected data was withheld (fail-closed).",
          severity: "error",
        });
      }
    } else {
      this.auditor.emit({
        event: "REQUEST_PROTECTED",
        requestId,
        sessionId: session.id,
        inputType: input.type,
        policy: this.policy.name,
        count: ctx.detected.length,
      });
    }

    const summary = summarize(ctx.detected, this.entities);
    const processingTimeMs = Math.round(performance.now() - started);
    const language = ctx.language;
    const result: ProtectionResult = {
      sessionId: session.id,
      requestId,
      type: input.type,
      status,
      safeData,
      protectedData: safeData,
      detectedEntities: ctx.detected,
      actions: ctx.actions,
      warnings: ctx.warnings,
      minimization: ctx.minimization(),
      summary,
      policy: this.policy.name,
      metadata: {
        processingTimeMs,
        detectorVersions: this.detection.versions(),
        failMode: this.failMode,
        ...(language !== undefined ? { language } : {}),
        ...(pages !== undefined ? { pages } : {}),
      },
    };
    this.logger.info("Protected request", {
      requestId,
      sessionId: session.id,
      inputType: input.type,
      policy: this.policy.name,
      status,
      entityCounts: summary.counts,
      entityTotal: summary.total,
      processingTimeMs,
      warningCodes: ctx.warnings.map((w) => w.code),
    });
    return result as ProtectionResult<SafeDataFor<I>>;
  }

  /** Detect sensitive data without protecting it or creating a session. */
  async scan(input: ProtectInput): Promise<ScanResult> {
    this.assertUsable();
    const started = performance.now();
    validateInputShape(input);
    const requestId = `req_${randomId(12)}`;
    const ctx = this.createContext(input, undefined, requestId, "scan");
    const { pages } = await this.dispatch(ctx, input);
    const processingTimeMs = Math.round(performance.now() - started);
    return {
      requestId,
      type: input.type,
      status: ctx.incomplete ? "incomplete" : "complete",
      detectedEntities: ctx.detected,
      warnings: ctx.warnings,
      summary: summarize(ctx.detected, this.entities),
      metadata: {
        processingTimeMs,
        detectorVersions: this.detection.versions(),
        ...(pages !== undefined ? { pages } : {}),
      },
    };
  }

  /**
   * Scan an AI response, apply the output policy and restore permitted
   * tokens. Pass the `sessionId` from the protection result (or an
   * AIResponse produced by `generate`, which carries it).
   */
  async release(response: string | AIResponse, sessionId?: string): Promise<ReleaseResult> {
    this.assertUsable();
    const started = performance.now();
    const text = typeof response === "string" ? response : response?.text;
    if (typeof text !== "string")
      throw new InputValidationError("release() expects a string or an AIResponse with text.");
    const id = sessionId ?? (typeof response === "string" ? undefined : response.sessionId);
    const session = id !== undefined ? this.sessions.get(id) : undefined;
    if (session) await this.sessions.touch(session);
    const requestId = `req_${randomId(12)}`;

    const result = await releaseText(
      {
        detection: this.detection,
        policy: this.policyEngine,
        tokenizer: this.tokenizer,
        restorer: this.restorer,
        auditor: this.auditor,
        maxTextBytes: this.limits.maxTextBytes,
      },
      text,
      session,
      requestId,
      id === undefined || session === undefined,
    );

    if (session && this.options.retention === "zero") await this.destroySession(session.id);
    const processingTimeMs = Math.round(performance.now() - started);
    this.logger.info("Released response", {
      requestId,
      ...(session ? { sessionId: session.id } : {}),
      status: result.status,
      restoredTokens: result.restoredTokens,
      unrestoredTokens: result.unrestoredTokens,
      entityTotal: result.detectedEntities.length,
      processingTimeMs,
    });
    return { ...result, metadata: { processingTimeMs } };
  }

  /**
   * Convenience wrapper around `release()` that returns the restored text.
   * Throws BlockedError if the output policy blocked the response.
   */
  async restore(response: string | AIResponse, sessionId: string): Promise<string> {
    const result = await this.release(response, sessionId);
    if (result.status === "blocked" || result.data === null) {
      throw new BlockedError("AI response was blocked by the output policy.", {
        details: { entities: result.detectedEntities.length },
      });
    }
    if (result.warnings.some((w) => w.code === "NO_SESSION")) {
      throw new RestorationError("Session not found or expired; tokens cannot be restored.");
    }
    return result.data;
  }

  /**
   * Protect input, call the provider with the safe payload, and release the
   * response. Never sends data when protection is blocked, or when it is
   * uncertain in fail-closed mode.
   */
  async generate(
    provider: AIProvider,
    input: ProtectInput,
    options: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const protection = await this.protect(input);
    if (protection.status === "blocked") {
      throw new BlockedError("Request blocked by policy; nothing was sent to the AI provider.", {
        details: { blockedTypes: protection.minimization.blocked },
      });
    }
    if (
      protection.safeData === null ||
      (protection.status === "uncertain" && options.allowUncertain === false)
    ) {
      throw new SecurityError(
        "Content could not be fully inspected; nothing was sent to the AI provider.",
        {
          details: { warnings: protection.warnings.map((w) => w.code) },
        },
      );
    }

    const request = buildRequest(protection, options);
    const response = await provider.generate(request);
    const release = await this.release({ ...response, sessionId: protection.sessionId });
    const { text: _text, ...meta } = response;
    this.logger.info("Provider call completed", {
      requestId: protection.requestId,
      provider: provider.name,
      ...(response.model ? { model: response.model } : {}),
    });
    return { text: release.data, protection, release, response: meta };
  }

  /** Destroy a session and all of its token mappings. */
  async destroySession(sessionId: string): Promise<boolean> {
    const destroyed = await this.sessions.destroy(sessionId);
    if (destroyed) this.auditor.emit({ event: "SESSION_DESTROYED", sessionId });
    return destroyed;
  }

  /** Release OCR workers and destroy all sessions. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.sessions.destroyAll();
    await this.store.clear();
    const engine = this.ocrEngine;
    this.ocrEngine = undefined;
    this.ocrInit = undefined;
    await engine?.dispose?.();
    if (this.store instanceof EncryptedMappingStore) this.store.destroyKey();
  }

  get activeSessions(): number {
    return this.sessions.size;
  }

  private createContext(
    input: ProtectInput,
    session: Session | undefined,
    requestId: string,
    mode: "protect" | "scan",
  ): ProtectionContext {
    const language =
      input.language ??
      this.options.language ??
      (input.type === "text" && typeof input.data === "string"
        ? guessLanguage(input.data)
        : undefined);
    const services: PipelineServices = {
      detection: this.detection,
      policy: this.policyEngine,
      registry: this.entities,
      tokenizer: this.tokenizer,
      pseudonymizer: this.pseudonymizer,
      limits: this.limits,
      ocr: () => this.getOcr(),
      ocrUnavailableReason: () => this.ocrError,
      ocrSemaphore: this.ocrSemaphore,
      faceDetector: this.options.faceDetector,
      auditor: this.auditor,
    };
    return new ProtectionContext(
      services,
      session,
      requestId,
      new Deadline("Protection", this.limits.timeoutMs),
      mode,
      input.purpose,
      language,
    );
  }

  private async dispatch(
    ctx: ProtectionContext,
    input: ProtectInput,
  ): Promise<{ safeData: SafeData | null; pages?: number }> {
    switch (input.type) {
      case "text":
        return { safeData: await processTextInput(ctx, input.data) };
      case "image": {
        const file = validateFile(input, this.limits);
        return { safeData: await processImageInput(ctx, file.buffer) };
      }
      case "pdf": {
        const file = validateFile(input, this.limits);
        const result = await processPdfInput(ctx, file.buffer, input.mode ?? "content", {
          ...this.options.pdf,
          verify: this.options.pdf?.verify ?? this.options.mode === "strict",
        });
        return { safeData: result.data, pages: result.pages };
      }
      case "docx": {
        const file = validateFile(input, this.limits);
        return {
          safeData: await processDocxInput(
            ctx,
            file.buffer,
            input.mode ?? "content",
            this.options.docx ?? {},
          ),
        };
      }
    }
  }

  private async getOcr(): Promise<OcrEngine | undefined> {
    if (this.options.ocr === false) {
      this.ocrError = "OCR is disabled in the ARAN configuration.";
      return undefined;
    }
    if (this.ocrEngine) return this.ocrEngine;
    this.ocrInit ??= (async () => {
      const engine = new TesseractEngine((this.options.ocr ?? {}) as TesseractEngineOptions);
      try {
        await engine.ensureAvailable();
        this.ocrEngine = engine;
        this.ocrError = undefined;
        return engine;
      } catch (error) {
        this.ocrError =
          error instanceof AranError ? error.message : "Local OCR engine could not be initialised.";
        this.ocrInit = undefined;
        return undefined;
      }
    })();
    return this.ocrInit;
  }

  private assertUsable(): void {
    if (this.disposed) throw new AranError("This Aran instance has been disposed.");
  }
}

function createStore(options: AranOptions): MappingStore {
  const choice = options.mappingStore ?? "memory";
  if (choice === "memory") {
    return options.encryptionKey
      ? new EncryptedMappingStore(new MemoryMappingStore(), options.encryptionKey)
      : new MemoryMappingStore();
  }
  if (choice === "encrypted-memory")
    return new EncryptedMappingStore(new MemoryMappingStore(), options.encryptionKey);
  return options.encryptionKey ? new EncryptedMappingStore(choice, options.encryptionKey) : choice;
}

function validateInputShape(input: unknown): asserts input is ProtectInput {
  if (input === null || typeof input !== "object")
    throw new InputValidationError("protect() expects an input object.");
  const type = (input as { type?: unknown }).type;
  if (type !== "text" && type !== "image" && type !== "pdf" && type !== "docx") {
    throw new InputValidationError('Input type must be one of "text", "image", "pdf", "docx".');
  }
  if (!("data" in input) || (input as { data?: unknown }).data === undefined)
    throw new InputValidationError("Input data is required.");
  const purpose = (input as { purpose?: unknown }).purpose;
  if (purpose !== undefined && (typeof purpose !== "string" || purpose.length > 500)) {
    throw new InputValidationError("purpose must be a string of at most 500 characters.");
  }
}

/** Build a provider request from a protection result's safe payload. */
export function buildRequest(
  protection: ProtectionResult,
  options: GenerateOptions = {},
): AIRequest {
  const data = protection.safeData;
  if (data === null) throw new SecurityError("No safe data available to send.");
  const system = [options.system, options.tokenHint === false ? undefined : TOKEN_HINT]
    .filter(Boolean)
    .join("\n\n");
  let content: AIRequest["messages"][number]["content"];
  switch (protection.type) {
    case "text":
      content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      break;
    case "image": {
      const image = data as ImageSafeData;
      const parts: AIContentPart[] = [
        { type: "image", data: image.image.toString("base64"), mimeType: image.mimeType },
      ];
      if (image.text)
        parts.push({ type: "text", text: `Text visible in the image (sanitized):\n${image.text}` });
      content = parts;
      break;
    }
    case "pdf":
    case "docx":
      content = (data as DocumentSafeData).text;
      break;
  }

  return {
    messages: [{ role: "user", content }],
    ...(system ? { system } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
}
