import { TokenizationError } from "../core/errors.js";
import type { Session } from "../core/context.js";
import type { EntityType } from "../entities/entity-types.js";
import type { MappingStore } from "../restoration/mapping-store.js";

/**
 * Reversible tokenization: `John Smith` → `[PERSON_001]`.
 * Tokens contain only the entity type and a per-session counter, never any
 * part of the original value. The same value always maps to the same token
 * within a session.
 */
export function renderToken(type: EntityType, n: number): string {
  return `[${type}_${String(n).padStart(3, "0")}]`;
}

export function redactionMarker(type: EntityType): string {
  return `[${type}_REDACTED]`;
}

/** Normalise a value so trivially different spellings share one token. */
export function normalizeValue(type: EntityType, value: string): string {
  const collapsed = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  switch (type) {
    case "EMAIL":
    case "UPI_ID":
    case "URL":
    case "INTERNAL_URL":
    case "USERNAME":
      return collapsed.toLowerCase();
    case "PHONE":
    case "AADHAAR":
    case "CREDIT_CARD":
    case "SSN":
    case "BANK_ACCOUNT": {
      const digits = collapsed.replace(/\D/g, "");
      // +91 98765 43210 and 9876543210 are the same phone number.
      return type === "PHONE" && digits.length > 10 ? digits.slice(-10) : digits;
    }
    case "IBAN":
    case "PAN":
    case "PASSPORT":
    case "MAC_ADDRESS":
      return collapsed.replace(/[\s\-:]/g, "").toUpperCase();
    case "PERSON":
    case "ADDRESS":
    case "HEALTHCARE_PROVIDER":
      return collapsed.toLowerCase();
    default:
      return collapsed;
  }
}

export interface TokenizeResult {
  token: string;
  /** True if a counter value was skipped because the input already contained that token. */
  collisionAvoided: boolean;
}

export class Tokenizer {
  constructor(
    private readonly store: MappingStore,
    private readonly ttlMs: number,
  ) {}

  async tokenize(
    session: Session,
    type: EntityType,
    value: string,
    restorable: boolean,
  ): Promise<TokenizeResult> {
    if (!/^[A-Z][A-Z0-9_]*$/.test(type))
      throw new TokenizationError("Invalid entity type for tokenization.");
    const fingerprint = session.fingerprint(type, normalizeValue(type, value));
    const existing = session.lookup(fingerprint);
    if (existing) return { token: existing, collisionAvoided: false };

    const { token, skipped } = session.nextNumber(type, (n) => renderToken(type, n));
    const key = session.storeKey(token);
    await this.store.set(key, {
      entityType: type,
      value,
      restorable,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    });
    session.keys.add(key);
    session.remember(fingerprint, token);
    return { token, collisionAvoided: skipped };
  }
}
