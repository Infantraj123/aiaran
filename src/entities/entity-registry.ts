import { PolicyError } from "../core/errors.js";
import {
  createFunctionDetector,
  createPatternDetector,
  type DetectFunction,
  type PatternDetectorOptions,
} from "../detection/custom-detector.js";
import type { Detector } from "../detection/detector.js";
import type { ProtectionActionType } from "../policy/policy.js";
import type { EntityCategory, EntityType } from "./entity-types.js";

export interface EntityDefinition {
  name: EntityType;
  category: EntityCategory;
  description: string;
  /** Higher priority wins when overlapping detections have similar confidence. */
  priority: number;
  /** Action used when a policy has no rule for this type. Falls back to the policy default. */
  defaultAction?: ProtectionActionType;
}

const CATEGORY_PRIORITY: Record<EntityCategory, number> = {
  security: 100,
  government: 90,
  financial: 85,
  healthcare: 80,
  custom: 75,
  identity: 70,
  network: 60,
  demographic: 40,
};

const d = (name: EntityType, category: EntityCategory, description: string): EntityDefinition => ({
  name,
  category,
  description,
  priority: CATEGORY_PRIORITY[category],
});

export const BUILT_IN_ENTITIES: readonly EntityDefinition[] = [
  d("PERSON", "identity", "Person name"),
  d("EMAIL", "identity", "Email address"),
  d("PHONE", "identity", "Phone number"),
  d("ADDRESS", "identity", "Postal address or address fragment"),
  d("DATE_OF_BIRTH", "identity", "Date of birth"),
  d("USERNAME", "identity", "Username or login identifier"),
  d("AGE", "demographic", "Age in years"),
  d("FACE", "identity", "Human face (requires a configured face detector)"),
  d("AADHAAR", "government", "Indian Aadhaar number"),
  d("PAN", "government", "Indian Permanent Account Number"),
  d("PASSPORT", "government", "Passport number"),
  d("DRIVER_LICENSE", "government", "Driver's licence number"),
  d("NATIONAL_ID", "government", "National identity number"),
  d("SSN", "government", "US Social Security Number"),
  d("CREDIT_CARD", "financial", "Payment card number"),
  d("BANK_ACCOUNT", "financial", "Bank account number"),
  d("IBAN", "financial", "International Bank Account Number"),
  d("UPI_ID", "financial", "UPI virtual payment address"),
  d("TRANSACTION_ID", "financial", "Transaction or payment reference"),
  d("PASSWORD", "security", "Password or passphrase"),
  d("API_KEY", "security", "API key"),
  d("ACCESS_TOKEN", "security", "Access/bearer token"),
  d("JWT", "security", "JSON Web Token"),
  d("PRIVATE_KEY", "security", "Private key material"),
  d("SECRET", "security", "Generic secret value"),
  d("DATABASE_URL", "security", "Database connection string"),
  d("AWS_ACCESS_KEY", "security", "AWS access key ID"),
  d("GITHUB_TOKEN", "security", "GitHub token"),
  d("PATIENT_ID", "healthcare", "Patient identifier"),
  d("MEDICAL_RECORD_NUMBER", "healthcare", "Medical record number"),
  d("INSURANCE_ID", "healthcare", "Insurance / member identifier"),
  d("HEALTHCARE_PROVIDER", "healthcare", "Healthcare provider or facility"),
  d("IP_ADDRESS", "network", "IP address"),
  d("MAC_ADDRESS", "network", "MAC address"),
  d("URL", "network", "Public URL"),
  d("INTERNAL_URL", "network", "Internal/private URL"),
];

export interface RegisterEntityOptions {
  name: string;
  category?: EntityCategory;
  description?: string;
  priority?: number;
  defaultAction?: ProtectionActionType;
  /** Detector for this entity: a Detector, a RegExp, pattern options, or a detect function. */
  detector?: Detector | RegExp | Omit<PatternDetectorOptions, "entityType"> | DetectFunction;
}

const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Registry of known entity types and their custom detectors. */
export class EntityRegistry {
  private readonly definitions = new Map<string, EntityDefinition>();
  private readonly customDetectors: Detector[] = [];

  constructor() {
    for (const def of BUILT_IN_ENTITIES) this.definitions.set(def.name, def);
  }

  register(options: RegisterEntityOptions): EntityDefinition {
    if (!NAME_RE.test(options.name)) {
      throw new PolicyError("Entity type names must be UPPER_SNAKE_CASE (2-64 characters).", {
        details: { name: options.name.slice(0, 64) },
      });
    }
    if (
      this.definitions.has(options.name) &&
      BUILT_IN_ENTITIES.some((b) => b.name === options.name) &&
      !options.detector
    ) {
      throw new PolicyError(`Entity type "${options.name}" is already registered.`);
    }
    const category = options.category ?? "custom";
    const def: EntityDefinition = {
      name: options.name,
      category,
      description: options.description ?? `Custom entity ${options.name}`,
      priority: options.priority ?? CATEGORY_PRIORITY[category],
      ...(options.defaultAction ? { defaultAction: options.defaultAction } : {}),
    };
    if (!BUILT_IN_ENTITIES.some((b) => b.name === options.name))
      this.definitions.set(options.name, def);

    if (options.detector) this.customDetectors.push(toDetector(options.name, options.detector));
    return this.definitions.get(options.name) ?? def;
  }

  /** Add a detector for an existing (built-in or custom) type. */
  addDetector(detector: Detector): void {
    this.customDetectors.push(detector);
  }

  get(name: EntityType): EntityDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: EntityType): boolean {
    return this.definitions.has(name);
  }

  priority(name: EntityType): number {
    return this.definitions.get(name)?.priority ?? CATEGORY_PRIORITY.custom;
  }

  category(name: EntityType): EntityCategory {
    return this.definitions.get(name)?.category ?? "custom";
  }

  list(): EntityDefinition[] {
    return [...this.definitions.values()];
  }

  detectors(): readonly Detector[] {
    return this.customDetectors;
  }
}

function toDetector(
  name: string,
  source: NonNullable<RegisterEntityOptions["detector"]>,
): Detector {
  if (source instanceof RegExp) return createPatternDetector({ entityType: name, pattern: source });
  if (typeof source === "function")
    return createFunctionDetector(`custom.${name.toLowerCase()}`, [name], source);
  if ("detect" in source && typeof source.detect === "function") return source;
  return createPatternDetector({
    ...(source as Omit<PatternDetectorOptions, "entityType">),
    entityType: name,
  });
}
