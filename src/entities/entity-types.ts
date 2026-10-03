/**
 * Built-in sensitive entity types. Custom types can be registered at runtime,
 * so `EntityType` is open-ended while still offering autocomplete for built-ins.
 */
export const BUILT_IN_ENTITY_TYPES = [
  // Identity
  "PERSON",
  "EMAIL",
  "PHONE",
  "ADDRESS",
  "DATE_OF_BIRTH",
  "USERNAME",
  "AGE",
  "FACE",
  // Government
  "AADHAAR",
  "PAN",
  "PASSPORT",
  "DRIVER_LICENSE",
  "NATIONAL_ID",
  "SSN",
  // Financial
  "CREDIT_CARD",
  "BANK_ACCOUNT",
  "IBAN",
  "UPI_ID",
  "TRANSACTION_ID",
  // Security
  "PASSWORD",
  "API_KEY",
  "ACCESS_TOKEN",
  "JWT",
  "PRIVATE_KEY",
  "SECRET",
  "DATABASE_URL",
  "AWS_ACCESS_KEY",
  "GITHUB_TOKEN",
  // Healthcare
  "PATIENT_ID",
  "MEDICAL_RECORD_NUMBER",
  "INSURANCE_ID",
  "HEALTHCARE_PROVIDER",
  // Network
  "IP_ADDRESS",
  "MAC_ADDRESS",
  "URL",
  "INTERNAL_URL",
] as const;

export type BuiltInEntityType = (typeof BUILT_IN_ENTITY_TYPES)[number];

// `string & {}` keeps literal autocomplete while accepting custom types.
export type EntityType = BuiltInEntityType | (string & {});

export type EntityCategory =
  | "identity"
  | "demographic"
  | "government"
  | "financial"
  | "security"
  | "healthcare"
  | "network"
  | "custom";

export type DetectionSource = "regex" | "secret" | "ner" | "context" | "custom" | "ocr" | "field";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
