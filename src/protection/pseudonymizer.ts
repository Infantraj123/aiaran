import type { Session } from "../core/context.js";
import type { EntityType } from "../entities/entity-types.js";
import type { MappingStore } from "../restoration/mapping-store.js";
import { normalizeValue, renderToken } from "./tokenizer.js";

/**
 * Pseudonymization replaces values with realistic but fictitious
 * substitutes (e.g. `John Smith` → `Avery Collins`, an `example.com` email,
 * or a reserved 555-01xx phone number). Substitutes are deterministic
 * within a session and restorable like tokens.
 *
 * Types without a natural fake form use format-preserving substitution
 * (digits → digits, letters → letters) keyed by an HMAC of the value.
 */
const FAKE_FIRST = [
  "Avery",
  "Jordan",
  "Riley",
  "Casey",
  "Morgan",
  "Quinn",
  "Rowan",
  "Sage",
  "Emerson",
  "Harper",
  "Kendall",
  "Reese",
  "Skyler",
  "Dakota",
  "Finley",
  "Hayden",
  "Parker",
  "Sawyer",
  "Arden",
  "Blair",
];
const FAKE_LAST = [
  "Collins",
  "Hayes",
  "Ellison",
  "Brooks",
  "Marlow",
  "Thorne",
  "Winslow",
  "Ashby",
  "Calloway",
  "Prescott",
  "Langley",
  "Merritt",
  "Sterling",
  "Whitaker",
  "Fairfax",
  "Holloway",
  "Kingsley",
  "Radcliffe",
  "Sinclair",
  "Vance",
];

export class Pseudonymizer {
  constructor(
    private readonly store: MappingStore,
    private readonly ttlMs: number,
  ) {}

  async pseudonymize(
    session: Session,
    type: EntityType,
    value: string,
    restorable: boolean,
  ): Promise<string> {
    const normalized = normalizeValue(type, value);
    const fingerprint = session.fingerprint(`PSEUDO:${type}`, normalized);
    const existing = session.lookup(fingerprint);
    if (existing) return existing;

    const seed = session.derive(`${type}\u0000${normalized}`);
    let pseudonym = this.generate(type, value, seed, 0);
    for (let attempt = 1; session.pseudonyms.has(pseudonym) || pseudonym === value; attempt++) {
      pseudonym = this.generate(type, value, session.derive(`${seed}:${attempt}`), attempt);
      if (attempt > 50) {
        pseudonym = renderToken(type, session.pseudonyms.size + 1);
        break;
      }
    }

    const key = session.storeKey(`pseudo:${pseudonym}`);
    await this.store.set(key, {
      entityType: type,
      value,
      restorable,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    });
    session.keys.add(key);
    session.pseudonyms.set(pseudonym, key);
    session.remember(fingerprint, pseudonym);
    return pseudonym;
  }

  private generate(type: EntityType, original: string, seedHex: string, attempt: number): string {
    const n = (i: number): number => parseInt(seedHex.slice(i * 4, i * 4 + 4), 16);
    switch (type) {
      case "PERSON": {
        const first = FAKE_FIRST[n(0) % FAKE_FIRST.length]!;
        const last = FAKE_LAST[n(1) % FAKE_LAST.length]!;
        return original.trim().includes(" ") ? `${first} ${last}` : first;
      }
      case "EMAIL":
        return `user${(n(0) % 9000) + 1000 + attempt}@example.com`;
      case "PHONE":
        return `+1 555-01${String(n(0) % 100).padStart(2, "0")}`;
      case "USERNAME":
        return `user_${seedHex.slice(0, 8)}`;
      case "URL":
      case "INTERNAL_URL":
        return `https://example.com/${seedHex.slice(0, 10)}`;
      case "IP_ADDRESS":
        return `192.0.2.${(n(0) % 254) + 1}`; // TEST-NET-1 (RFC 5737)
      default:
        return formatPreserving(original, seedHex);
    }
  }
}

/** Replace each digit/letter with a pseudo-random one of the same class. */
function formatPreserving(value: string, seedHex: string): string {
  let out = "";
  let i = 0;
  for (const ch of value) {
    const r = parseInt(seedHex[i % seedHex.length] ?? "0", 16) + i * 7;
    if (/\d/.test(ch)) out += String(r % 10);
    else if (/[A-Z]/.test(ch)) out += String.fromCharCode(65 + (r % 26));
    else if (/[a-z]/.test(ch)) out += String.fromCharCode(97 + (r % 26));
    else out += ch;
    i++;
  }
  return out;
}
