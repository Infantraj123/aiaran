# 10. Production and security

Demo: [`demos/08-production.ts`](../../demos/08-production.ts)

- [10.1 Every option](#101-every-option)
- [10.2 Where token mappings live](#102-where-token-mappings-live)
- [10.3 Encrypted and external stores (Redis example)](#103-encrypted-and-external-stores)
- [10.4 Retention and session lifetime](#104-retention-and-session-lifetime)
- [10.5 Running several server instances](#105-running-several-server-instances)
- [10.6 Logging](#106-logging)
- [10.7 Audit events](#107-audit-events)
- [10.8 Limits and timeouts](#108-limits-and-timeouts)
- [10.9 Handling results and errors safely](#109-handling-results-and-errors-safely)
- [10.10 Production checklist](#1010-production-checklist)
- [10.11 What ARAN does and does not protect against](#1011-what-aran-does-and-does-not-protect-against)

---

## 10.1 Every option

```ts
import { Aran } from "aiaran";

const aran = new Aran({
  // what to do with each entity type
  policy: "default", // built-in name | definition | { TYPE: action } | resolved Policy
  mode: "balanced", // "strict": fail-closed, threshold ≤ 0.35, PDF verification
  failMode: undefined, // "open" | "closed" (overrides the policy)
  minConfidence: undefined, // 0–1 (overrides the policy)

  // token mappings
  mappingStore: "memory", // "memory" | "encrypted-memory" | your MappingStore
  encryptionKey: undefined, // 32-byte key (Buffer, 64-char hex, or base64) → AES-256-GCM
  retention: "session", // "zero" = delete mappings right after release()
  sessionTtlMs: 60 * 60 * 1000, // 1 hour, extended on each use

  // detection
  detectors: [], // extra detectors (e.g. ML NER)
  disableDetectors: [], // "aran.pii" | "aran.secrets" | "aran.ner-heuristic"
  language: undefined, // default language hint ("en", "hi", "ta", …)

  // files
  ocr: { languages: ["eng"] }, // TesseractEngineOptions | your OcrEngine | false
  faceDetector: undefined, // your FaceDetector
  pdf: { ocr: "auto", renderScale: 2, verify: false },
  docx: { inspectImages: true },
  concurrency: 2, // max OCR jobs at the same time

  // safety limits
  limits: {
    maxTextBytes: 10 * 1024 * 1024,
    maxFileBytes: 50 * 1024 * 1024,
    maxPdfPages: 300,
    maxImageDimension: 16_384,
    maxImagePixels: 40_000_000,
    maxZipEntries: 2_000,
    maxUncompressedBytes: 200 * 1024 * 1024,
    maxCompressionRatio: 200,
    maxObjectDepth: 64,
    maxObjectNodes: 100_000,
    maxEntities: 100_000,
    timeoutMs: 120_000,
    ocrTimeoutMs: 60_000,
  },

  // observability
  logger: undefined, // your Logger, or false; fields are always sanitized
  logLevel: "warn", // for the built-in console logger (writes JSON to stderr)
  audit: undefined, // (event) => void
});
```

## 10.2 Where token mappings live

To restore `[PERSON_001]` → `Ravi Kumar`, ARAN must remember the mapping somewhere:

| Option                                | Where                | Survives restart? | Encrypted?                                       | Use for                                    |
| ------------------------------------- | -------------------- | ----------------- | ------------------------------------------------ | ------------------------------------------ |
| `"memory"` (default)                  | process memory       | no                | no (never leaves the process)                    | most apps                                  |
| `"encrypted-memory"`                  | process memory       | no                | yes, AES-256-GCM with a random per-instance key  | defence in depth (memory dumps, debuggers) |
| your `MappingStore` + `encryptionKey` | Redis, a database, … | yes               | **yes**, ARAN encrypts before calling your store | long sessions, audit requirements          |
| your `MappingStore` **without** a key | your store           | yes               | no                                               | ⚠ not recommended                          |

Redacted values (`[EMAIL_REDACTED]`) are **never stored anywhere**.

## 10.3 Encrypted and external stores

From demo 8: a store that only ever receives ciphertext.

```ts
import { Aran, generateKey, type MappingStore, type ProtectedValue } from "aiaran";

const external = new Map<string, ProtectedValue>(); // stand-in for Redis
const store: MappingStore = {
  async set(key, value) {
    external.set(key, value);
  },
  async get(key) {
    return external.get(key);
  },
  async delete(key) {
    external.delete(key);
  },
  async clear() {
    external.clear();
  },
};

const aran = new Aran({
  mappingStore: store,
  encryptionKey: generateKey(), // production: load from KMS / secret manager
  retention: "zero",
});
```

What the store received (demo output):

```text
ses_zv4iXzjV8KlzKcYwj_2_4g:[PE… → v1.YPZmIk0e6XmdZC9-.SIt3F5liQJ7O_wKJup8V… (encrypted=true)
ses_zv4iXzjV8KlzKcYwj_2_4g:[EM… → v1.uAZ_QdNNGVms07Yv.vtiU_3rTOI4_KIl3iD2h… (encrypted=true)
```

**Redis (ioredis) store:**

```ts
import Redis from "ioredis";
import type { MappingStore, ProtectedValue } from "aiaran";

const redis = new Redis(process.env.REDIS_URL!);
const PREFIX = "aran:";

export const redisStore: MappingStore = {
  async set(key, value) {
    const ttlMs = value.expiresAt ? Math.max(1, value.expiresAt - Date.now()) : 3_600_000;
    await redis.set(PREFIX + key, JSON.stringify(value), "PX", ttlMs);
  },
  async get(key) {
    const raw = await redis.get(PREFIX + key);
    return raw ? (JSON.parse(raw) as ProtectedValue) : undefined;
  },
  async delete(key) {
    await redis.del(PREFIX + key);
  },
  async clear() {
    for await (const keys of redis.scanStream({ match: `${PREFIX}*`, count: 500 })) {
      if ((keys as string[]).length) await redis.del(...(keys as string[]));
    }
  },
};

const aran = new Aran({
  mappingStore: redisStore,
  encryptionKey: process.env.ARAN_KEY! /* 64 hex chars */,
});
```

**About the encryption:**

- AES-256-GCM, a fresh random 96-bit IV per value, and a 128-bit authentication tag, using Node.js's built-in `crypto`.
- The storage key, entity type and "restorable" flag are bound to the ciphertext. Copying a value to another token, or flipping its flag, makes decryption fail with `SecurityError`.
- Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, or `generateKey()`.
- From a passphrase: `deriveKeyFromPassphrase(passphrase, salt)` (scrypt). Prefer a random key from a KMS.
- Losing the key means stored mappings cannot be restored. Rotating it invalidates existing sessions (they expire anyway).

## 10.4 Retention and session lifetime

```ts
new Aran({ retention: "zero" }); // delete mappings right after release()
new Aran({ sessionTtlMs: 15 * 60 * 1000 }); // expire idle sessions after 15 minutes
await aran.destroySession(sessionId); // delete one conversation now (e.g. user logs out)
await aran.dispose(); // delete everything (shutdown)
```

Demo output with `retention: "zero"`:

```text
Escalated to Anita Desai via anita.desai@example.com.
mappings left in store: 0 | active sessions: 0
```

| Workload                        | Suggested setting                                        |
| ------------------------------- | -------------------------------------------------------- |
| single question → single answer | `retention: "zero"`                                      |
| chat conversations              | default, plus `destroySession()` when the chat ends      |
| batch jobs                      | `retention: "zero"`, or call `destroySession()` per item |

## 10.5 Running several server instances

Session state (the per-session key, token counters and the lookup index) lives in the **process** that created the session. A custom `MappingStore` keeps the encrypted _values_ outside the process, but `release()` must still run on the **same instance** that ran `protect()`.

For multi-instance deployments:

- **Recommended:** route each conversation to the same instance (sticky sessions by user or conversation ID), or
- run protect → AI → release within **one request** (for example `generate()`), so the session never needs to cross instances.

If `release()` runs where the session is unknown, ARAN does not guess. It returns the text unrestored with a `NO_SESSION` warning, and `restore()` throws `RestorationError`.

## 10.6 Logging

ARAN's logger accepts only an **allowlist** of fields: request and session IDs, policy, status, counts, timings and warning codes. Anything else is dropped, so values cannot be logged even by mistake. Demo output:

```text
INFO Protected request {"requestId":"req_R3YnPCAZWaXivUA8","sessionId":"ses_zv4iXzjV8KlzKcYwj_2_4g","inputType":"text","policy":"enterprise","status":"safe","entityCounts":{"PERSON":1,"EMAIL":1},"entityTotal":2,"processingTimeMs":31,"warningCodes":[]}
INFO Released response {"requestId":"req_zq3EsRgK1cgXoycT","sessionId":"ses_zv4iXzjV8KlzKcYwj_2_4g","status":"safe","restoredTokens":2,"unrestoredTokens":0,"entityTotal":0,"processingTimeMs":21}
```

```ts
new Aran({ logLevel: "info" }); // built-in JSON logger → stderr ("debug" | "info" | "warn" | "error" | "silent")
new Aran({ logger: false }); // no logs at all

// your logger (pino, winston, …): fields are sanitized before they reach it
import pino from "pino";
const log = pino();
new Aran({
  logger: {
    debug: (m, f) => log.debug(f, m),
    info: (m, f) => log.info(f, m),
    warn: (m, f) => log.warn(f, m),
    error: (m, f) => log.error(f, m),
  },
});
```

**In your own code:** never log the original input. Logging `result.safeData`, `summary` and `warnings` is fine.

## 10.7 Audit events

```ts
const aran = new Aran({ audit: (event) => siem.send(event) });
```

Demo output:

```text
SESSION_CREATED
ENTITY_PROTECTED PERSON TOKENIZE
ENTITY_PROTECTED EMAIL TOKENIZE
REQUEST_PROTECTED   2
TOKENS_RESTORED   2
SESSION_DESTROYED
```

Event shape:

```ts
{
  event: "ENTITY_PROTECTED",
  timestamp: "2026-10-03T15:23:31.552Z",
  requestId: "req_…",
  sessionId: "ses_…",
  entityType: "EMAIL",
  action: "TOKENIZE",
  confidence: 0.95,
  source: "regex"
}
```

| Event                                                         | When                                          |
| ------------------------------------------------------------- | --------------------------------------------- |
| `SESSION_CREATED` / `SESSION_DESTROYED`                       | session lifecycle                             |
| `ENTITY_PROTECTED`                                            | once per entity in `protect()`                |
| `REQUEST_PROTECTED` / `REQUEST_BLOCKED` / `REQUEST_UNCERTAIN` | final outcome of `protect()`                  |
| `OUTPUT_ENTITY_DETECTED`                                      | unexpected sensitive value in an AI answer    |
| `OUTPUT_BLOCKED`                                              | an AI answer was withheld                     |
| `TOKENS_RESTORED`                                             | tokens restored in `release()` (with `count`) |

Audit events never contain values. A failing or slow audit sink never breaks processing (errors are swallowed).

## 10.8 Limits and timeouts

All limits are listed in 10.1. When one is exceeded:

| Limit                                                       | Result                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| size, pages, pixels, zip size, ratio, entries, depth, nodes | `SecurityError` is thrown (nothing processed)                        |
| `maxEntities`                                               | the first N are protected, then `ENTITY_LIMIT_REACHED` → `uncertain` |
| `timeoutMs`                                                 | `TimeoutError`                                                       |
| `ocrTimeoutMs`                                              | `OCR_FAILED` for that image or page → `uncertain`                    |

Set limits to match what your app accepts. Smaller limits reduce the risk of denial of service.

## 10.9 Handling results and errors safely

From demo 8:

```ts
import { AranError, BlockedError, SecurityError } from "aiaran";

async function protectOrExplain(text: string) {
  try {
    const r = await aran.protect({ type: "text", data: text });
    if (r.status === "blocked")
      throw new BlockedError(`Blocked: ${r.minimization.blocked.join(", ")}`);
    if (r.safeData === null)
      throw new SecurityError("Could not fully inspect the input (fail-closed).");
    return r.safeData;
  } catch (error) {
    if (error instanceof AranError) console.log(`${error.name} [${error.code}]: ${error.message}`);
    else throw error;
  }
}
```

```text
OK → Deploy notes for [PERSON_001]
BlockedError [BLOCKED]: Blocked: AWS_ACCESS_KEY
SecurityError [SECURITY_ERROR]: Text input exceeds the maximum allowed size.
```

Every ARAN error has `name`, `code`, `message` and `details`. None of them includes your data, so they are safe to log and return to clients. Error classes: `AranError` (base), `DetectionError`, `PolicyError`, `UnsupportedFormatError`, `OCRFailureError`, `DocumentProcessingError`, `TokenizationError`, `RestorationError`, `SecurityError`, `InputValidationError`, `ProviderError`, `DependencyMissingError`, `TimeoutError`, `BlockedError`.

## 10.10 Production checklist

**Setup**

- [ ] `npx aran doctor` shows ✓ for every feature you use, on the **production** machine or image.
- [ ] Fonts are installed on Linux servers (for redaction labels).
- [ ] pdfjs-dist ≥ 6.2.108 on Node 22.13+ ([chapter 1.3](01-installation-and-setup.md#which-pdfjs-dist-version)).

**Configuration**

- [ ] A fail-closed policy (`strict`, `healthcare`, `financial` or `enterprise`) for regulated data.
- [ ] Policy reviewed and validated (`aran policy validate`) and kept in version control.
- [ ] `purpose` set on requests where less data is needed.
- [ ] Custom entity types registered for your own identifiers (employee IDs, case numbers, …).
- [ ] Limits set to what your app actually accepts.

**Mappings**

- [ ] `retention: "zero"` or `destroySession()` at the end of each conversation.
- [ ] `sessionTtlMs` as short as your use case allows.
- [ ] If mappings leave the process: `encryptionKey` from a KMS or secret manager.
- [ ] Sticky routing if you run several instances (10.5).

**Code**

- [ ] Only `safeData` is ever sent to an AI; `status` is checked first (or `generate()` is used).
- [ ] The original input is never logged.
- [ ] `release()` is run on every AI answer before showing it to users.
- [ ] One `Aran` instance per process; `dispose()` on shutdown.

**Monitoring**

- [ ] Audit events go to your SIEM, with alerts on `REQUEST_UNCERTAIN`, `REQUEST_BLOCKED` and `OUTPUT_ENTITY_DETECTED`.
- [ ] `warnings` are monitored (codes, not messages).

## 10.11 What ARAN does and does not protect against

ARAN **reduces** the chance of sensitive data reaching an AI provider. It does **not**:

- detect every possible piece of personal data (names without cues, unusual formats, unsupported languages)
- prevent re-identification from the context that remains (rare conditions, small towns, unique job titles)
- protect against a compromised server, since ARAN runs inside your process
- control what a provider does with the protected data
- make your system HIPAA, GDPR or DPDP compliant by itself

Read the full [threat model](../threat-model.md) and [SECURITY.md](../../SECURITY.md).

---

← [9. CLI](09-cli.md) · Next: [11. Troubleshooting and FAQ →](11-troubleshooting-and-faq.md)
