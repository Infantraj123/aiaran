// Core
export { Aran, buildRequest, type GenerateOptions, type GenerateResult } from "./core/aran.js";
export * from "./core/errors.js";

// Types
export type * from "./types/input.js";
export type * from "./types/output.js";
export type * from "./types/configuration.js";

// Entities
export { BUILT_IN_ENTITY_TYPES } from "./entities/entity-types.js";
export type {
  BuiltInEntityType,
  EntityType,
  EntityCategory,
  DetectionSource,
  BoundingBox,
} from "./entities/entity-types.js";
export type { Entity, DetectedEntity } from "./entities/entity.js";
export {
  EntityRegistry,
  BUILT_IN_ENTITIES,
  type EntityDefinition,
  type RegisterEntityOptions,
} from "./entities/entity-registry.js";

// Detection
export type { Detector, DetectionInput, NerDetector } from "./detection/detector.js";
export { guessLanguage } from "./detection/detector.js";
export { RegexDetector, type PatternRule, type ContextRule } from "./detection/regex-detector.js";
export { createPiiDetector } from "./detection/pii-detector.js";
export { createSecretDetector } from "./detection/secret-detector.js";
export { HeuristicNerDetector } from "./detection/ner-detector.js";
export {
  createPatternDetector,
  createFunctionDetector,
  type PatternDetectorOptions,
  type DetectFunction,
} from "./detection/custom-detector.js";
export { luhnValid, verhoeffValid, ibanValid } from "./detection/validators.js";

// Policy
export type * from "./policy/policy.js";
export { PROTECTION_ACTIONS, OUTPUT_ACTIONS } from "./policy/policy.js";
export { BUILT_IN_POLICIES, BUILT_IN_POLICY_NAMES } from "./policy/built-in-policies.js";
export {
  resolvePolicy,
  loadPolicyFile,
  parsePolicyText,
  validatePolicyDefinition,
  type PolicyValidationIssue,
} from "./policy/policy-loader.js";

// Protection & restoration
export {
  MemoryMappingStore,
  type MappingStore,
  type ProtectedValue,
} from "./restoration/mapping-store.js";
export { EncryptedMappingStore } from "./protection/encryption.js";

// OCR
export type { OcrEngine, OcrResult, OcrWord, OcrOptions } from "./ocr/ocr-engine.js";
export { TesseractEngine, type TesseractEngineOptions } from "./ocr/tesseract-engine.js";
export type { FaceDetector } from "./formats/image/face-detector.js";

// Providers
export type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIMessage,
  AIContentPart,
  AIRole,
  AIStreamChunk,
} from "./providers/provider.js";
export {
  OpenAIProvider,
  OpenAICompatibleProvider,
  type OpenAICompatibleOptions,
} from "./providers/openai.js";
export { AnthropicProvider, type AnthropicProviderOptions } from "./providers/anthropic.js";
export { GeminiProvider, type GeminiOptions } from "./providers/google.js";
export { OllamaProvider, type OllamaOptions } from "./providers/ollama.js";
export { createProvider, PROVIDERS } from "./providers/generic.js";

// Security utilities
export { DEFAULT_LIMITS, type Limits } from "./security/limits.js";
export { generateKey, deriveKeyFromPassphrase } from "./security/crypto.js";
export {
  assertPublicUrl,
  classifyHost,
  isInternalHost,
  type HostClass,
} from "./security/network.js";

// Logging
export { ConsoleLogger, type Logger, type LogLevel } from "./logging/logger.js";
export type { AuditEvent, AuditEventName, AuditSink } from "./logging/audit.js";
