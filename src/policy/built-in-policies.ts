import type { EntityRule, Policy, ProtectionActionType } from "./policy.js";

type Rules = Partial<Record<string, EntityRule>>;

const rules = (
  action: ProtectionActionType,
  types: string[],
  extra: Partial<EntityRule> = {},
): Rules => Object.fromEntries(types.map((t) => [t, { action, ...extra }]));

const IDENTITY = ["PERSON", "EMAIL", "PHONE", "ADDRESS", "USERNAME"];
const GOVERNMENT = ["AADHAAR", "PAN", "PASSPORT", "DRIVER_LICENSE", "NATIONAL_ID", "SSN"];
const FINANCIAL_REVERSIBLE = ["BANK_ACCOUNT", "IBAN", "UPI_ID", "TRANSACTION_ID"];
const SECRETS = [
  "PASSWORD",
  "API_KEY",
  "ACCESS_TOKEN",
  "JWT",
  "PRIVATE_KEY",
  "SECRET",
  "DATABASE_URL",
  "AWS_ACCESS_KEY",
  "GITHUB_TOKEN",
];
const HEALTH_IDS = ["PATIENT_ID", "MEDICAL_RECORD_NUMBER", "INSURANCE_ID"];

/**
 * default — balanced: personal identifiers become reversible tokens so AI
 * answers can be personalised after release; secrets and card numbers are
 * irreversibly redacted.
 */
const defaultPolicy: Policy = {
  name: "default",
  version: "1",
  description:
    "Balanced protection: tokenize personal identifiers, redact secrets and card numbers.",
  defaultAction: "redact",
  minConfidence: 0.5,
  failMode: "open",
  entities: {
    ...rules("tokenize", [
      ...IDENTITY,
      ...GOVERNMENT,
      ...FINANCIAL_REVERSIBLE,
      ...HEALTH_IDS,
      "HEALTHCARE_PROVIDER",
      "INTERNAL_URL",
    ]),
    ...rules("redact", ["CREDIT_CARD", "DATE_OF_BIRTH", ...SECRETS]),
    ...rules("allow", ["AGE", "URL"]),
    ...rules("tokenize", ["IP_ADDRESS", "MAC_ADDRESS"]),
  },
  output: {
    restoreTokens: true,
    unexpectedEntityAction: "warn",
    entities: { ...outputRules("redact", SECRETS), CREDIT_CARD: "redact" },
  },
  purposes: [],
};

/** strict — fail-closed, lower detection threshold, block secrets and financial data. */
const strictPolicy: Policy = {
  name: "strict",
  version: "1",
  description:
    "Fail-closed. Lower detection threshold; block secrets and payment data; redact identifiers.",
  defaultAction: "redact",
  minConfidence: 0.35,
  failMode: "closed",
  entities: {
    ...rules("tokenize", [
      "PERSON",
      "EMAIL",
      "PHONE",
      "USERNAME",
      ...HEALTH_IDS,
      "HEALTHCARE_PROVIDER",
    ]),
    ...rules("redact", [
      "ADDRESS",
      "DATE_OF_BIRTH",
      ...GOVERNMENT,
      "BANK_ACCOUNT",
      "IBAN",
      "UPI_ID",
      "TRANSACTION_ID",
      "IP_ADDRESS",
      "MAC_ADDRESS",
      "INTERNAL_URL",
    ]),
    ...rules("block", ["CREDIT_CARD", ...SECRETS]),
    ...rules("allow", ["AGE"]),
    URL: { action: "redact" },
  },
  output: { restoreTokens: true, unexpectedEntityAction: "redact" },
  purposes: [],
};

const healthcarePolicy: Policy = {
  name: "healthcare",
  version: "1",
  description:
    "Clinical data: keep clinical context, tokenize patient identity, block payment data and secrets.",
  defaultAction: "redact",
  minConfidence: 0.45,
  failMode: "closed",
  entities: {
    ...rules("tokenize", ["PERSON", ...HEALTH_IDS, "HEALTHCARE_PROVIDER"]),
    ...rules("redact", [
      "EMAIL",
      "PHONE",
      "ADDRESS",
      "USERNAME",
      "DATE_OF_BIRTH",
      ...GOVERNMENT,
      "BANK_ACCOUNT",
      "IBAN",
      "UPI_ID",
      "TRANSACTION_ID",
      "IP_ADDRESS",
      "MAC_ADDRESS",
      "INTERNAL_URL",
    ]),
    ...rules("block", ["CREDIT_CARD", ...SECRETS]),
    ...rules("allow", ["AGE", "URL"]),
  },
  output: { restoreTokens: true, unexpectedEntityAction: "redact" },
  purposes: [
    {
      id: "clinical-analysis",
      description:
        "Clinical reasoning (risk, diagnosis, summaries) does not need direct identifiers.",
      keywords: [
        "clinical",
        "diagnos",
        "symptom",
        "risk",
        "cardio",
        "treatment",
        "condition",
        "medical",
        "summar",
        "triage",
        "prognosis",
        "lab result",
      ],
      entities: {
        PERSON: "redact",
        PATIENT_ID: "redact",
        MEDICAL_RECORD_NUMBER: "redact",
        INSURANCE_ID: "redact",
        HEALTHCARE_PROVIDER: "redact",
        ADDRESS: "redact",
        PHONE: "redact",
        EMAIL: "redact",
        AGE: "allow",
      },
    },
    {
      id: "patient-communication",
      description: "Drafting messages to the patient needs the name restored afterwards.",
      keywords: [
        "letter",
        "message to patient",
        "patient communication",
        "discharge instructions",
        "appointment reminder",
      ],
      entities: { PERSON: "tokenize", HEALTHCARE_PROVIDER: "tokenize", PATIENT_ID: "tokenize" },
    },
    {
      id: "billing",
      description:
        "Insurance and billing questions need insurance identifiers as reversible tokens.",
      keywords: ["billing", "claim", "insurance", "invoice", "reimburse"],
      entities: { INSURANCE_ID: "tokenize", PATIENT_ID: "tokenize", PERSON: "tokenize" },
    },
  ],
};

const financialPolicy: Policy = {
  name: "financial",
  version: "1",
  description: "Financial services: block card numbers and secrets, tokenize account identifiers.",
  defaultAction: "redact",
  minConfidence: 0.45,
  failMode: "closed",
  entities: {
    ...rules("tokenize", [
      "PERSON",
      "EMAIL",
      "PHONE",
      "USERNAME",
      "BANK_ACCOUNT",
      "IBAN",
      "UPI_ID",
      "TRANSACTION_ID",
      "PAN",
    ]),
    ...rules("redact", [
      "ADDRESS",
      "DATE_OF_BIRTH",
      "AADHAAR",
      "PASSPORT",
      "DRIVER_LICENSE",
      "NATIONAL_ID",
      "SSN",
      ...HEALTH_IDS,
      "HEALTHCARE_PROVIDER",
      "IP_ADDRESS",
      "MAC_ADDRESS",
      "INTERNAL_URL",
    ]),
    ...rules("block", ["CREDIT_CARD", ...SECRETS]),
    ...rules("allow", ["AGE", "URL"]),
  },
  output: {
    restoreTokens: true,
    unexpectedEntityAction: "redact",
    entities: { CREDIT_CARD: "block" },
  },
  purposes: [
    {
      id: "fraud-analysis",
      description: "Pattern analysis works on tokens; identities are not needed.",
      keywords: ["fraud", "anomaly", "risk", "pattern", "aml"],
      entities: {
        PERSON: "redact",
        EMAIL: "redact",
        PHONE: "redact",
        TRANSACTION_ID: "tokenize",
        BANK_ACCOUNT: "tokenize",
      },
    },
  ],
};

/** developer — code, logs and stack traces: redact secrets, keep technical context. */
const developerPolicy: Policy = {
  name: "developer",
  version: "1",
  description:
    "Source code and logs: redact credentials, tokenize personal data, keep URLs and IPs as tokens.",
  defaultAction: "redact",
  minConfidence: 0.5,
  failMode: "open",
  entities: {
    ...rules("redact", SECRETS),
    ...rules("tokenize", [...IDENTITY, "IP_ADDRESS", "MAC_ADDRESS", "INTERNAL_URL"]),
    ...rules("redact", [
      ...GOVERNMENT,
      "CREDIT_CARD",
      "BANK_ACCOUNT",
      "IBAN",
      "DATE_OF_BIRTH",
      ...HEALTH_IDS,
    ]),
    ...rules("allow", ["URL", "AGE", "TRANSACTION_ID", "UPI_ID", "HEALTHCARE_PROVIDER"]),
  },
  output: {
    restoreTokens: true,
    unexpectedEntityAction: "warn",
    entities: outputRules("redact", SECRETS),
  },
  purposes: [],
};

/** enterprise — fail-closed, internal infrastructure hidden, secrets blocked. */
const enterprisePolicy: Policy = {
  name: "enterprise",
  version: "1",
  description:
    "Corporate data: fail-closed, block secrets, hide internal infrastructure, tokenize people.",
  defaultAction: "redact",
  minConfidence: 0.45,
  failMode: "closed",
  entities: {
    ...rules("tokenize", [
      ...IDENTITY,
      "BANK_ACCOUNT",
      "IBAN",
      "UPI_ID",
      "TRANSACTION_ID",
      ...HEALTH_IDS,
      "HEALTHCARE_PROVIDER",
    ]),
    ...rules("redact", [
      "DATE_OF_BIRTH",
      ...GOVERNMENT,
      "IP_ADDRESS",
      "MAC_ADDRESS",
      "INTERNAL_URL",
    ]),
    ...rules("block", ["CREDIT_CARD", ...SECRETS]),
    ...rules("allow", ["AGE", "URL"]),
  },
  output: { restoreTokens: true, unexpectedEntityAction: "redact" },
  purposes: [],
};

function outputRules<T extends string>(action: T, types: string[]): Record<string, T> {
  return Object.fromEntries(types.map((t) => [t, action]));
}

export const BUILT_IN_POLICIES: Readonly<Record<string, Policy>> = Object.freeze({
  default: defaultPolicy,
  strict: strictPolicy,
  healthcare: healthcarePolicy,
  financial: financialPolicy,
  developer: developerPolicy,
  enterprise: enterprisePolicy,
});

export const BUILT_IN_POLICY_NAMES = Object.keys(BUILT_IN_POLICIES);
