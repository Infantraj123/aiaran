# 2. Core concepts

Read this once. Every other chapter builds on it.

- [2.1 The flow: protect → AI → release](#21-the-flow-protect--ai--release)
- [2.2 The `Aran` object](#22-the-aran-object)
- [2.3 Inputs](#23-inputs)
- [2.4 Actions: allow, redact, tokenize, pseudonymize, block](#24-actions)
- [2.5 Sessions and tokens](#25-sessions-and-tokens)
- [2.6 Status: safe, uncertain, blocked](#26-status-safe-uncertain-blocked)
- [2.7 Fail-open and fail-closed](#27-fail-open-and-fail-closed)
- [2.8 The ProtectionResult, field by field](#28-the-protectionresult-field-by-field)
- [2.9 The ReleaseResult, field by field](#29-the-releaseresult-field-by-field)
- [2.10 Method reference](#210-method-reference)
- [2.11 What ARAN never does](#211-what-aran-never-does)

---

## 2.1 The flow: protect → AI → release

```text
 your app                          ARAN                                   AI model
 ─────────                         ────                                   ────────
 user input  ──protect()──►  detect → apply policy → replace
                             returns safeData + sessionId  ─────────►   sees only
                                                                          [PERSON_001]
 final text  ◄──release()──  scan answer → output policy   ◄─────────   answers with
                             → restore tokens                             [PERSON_001]
```

1. **`protect()`** finds sensitive values, decides what to do with each one using the _policy_, and builds `safeData`.
2. You send **only `safeData`** to the AI.
3. **`release()`** checks the AI's answer for sensitive values that ARAN didn't put there, then turns tokens like `[PERSON_001]` back into the original values the policy allows.

`generate()` does all three steps in one call (see [chapter 8](08-ai-providers.md)).

## 2.2 The `Aran` object

```ts
import { Aran } from "aiaran";

const aran = new Aran({
  policy: "healthcare", // which rules to apply (chapter 7)
  mode: "strict", // optional: stricter behaviour
});
```

- Create **one instance** per configuration and **reuse it** for every request. It is safe to use concurrently, and OCR workers start only once.
- Different users or conversations are kept apart by **sessions** (2.5), not by separate instances.
- Call **`await aran.dispose()`** when shutting down. It deletes all mappings and stops OCR workers.

Every option is listed in [chapter 10](10-production-and-security.md#101-every-option).

## 2.3 Inputs

`protect()` and `scan()` take one input object. `type` says what `data` is:

| `type`    | `data`                                                          | Extra fields                                               | `safeData` you get back                                                   |
| --------- | --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `"text"`  | `string`                                                        |                                                            | `string`                                                                  |
| `"text"`  | object or array (JSON-like)                                     |                                                            | object/array of the same shape                                            |
| `"image"` | `Buffer` / `Uint8Array` / `ArrayBuffer` (PNG, JPEG, WebP, TIFF) | `filename?`, `mimeType?`                                   | `{ image: Buffer (PNG), mimeType: "image/png", text: string }`            |
| `"pdf"`   | bytes                                                           | `mode?: "content" \| "document"`, `filename?`, `mimeType?` | `{ text, pages: [{ page, text, source }], document?: Buffer, mimeType? }` |
| `"docx"`  | bytes                                                           | `mode?: "content" \| "document"`, `filename?`, `mimeType?` | `{ text, document?: Buffer, mimeType? }`                                  |

Fields available on every input:

| Field                | Meaning                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purpose?: string`   | Why you are calling the AI, e.g. `"summarize medical condition"`. Policies can remove more data for some purposes ([chapter 7](07-policies-and-minimization.md)). |
| `language?: string`  | Optional hint such as `"en"`, `"hi"` or `"ta"`. ARAN guesses from the script if you don't set it.                                                                 |
| `sessionId?: string` | Continue an existing session so the same values keep the same tokens (2.5).                                                                                       |

`filename` and `mimeType` are **checked, not trusted**. ARAN reads the file's real format from its first bytes and rejects mismatches, such as a PDF named `photo.png`.

## 2.4 Actions

The policy chooses one action per entity type:

| Action         | What goes to the AI                                                      | Can be restored?                   | Typical use                                           |
| -------------- | ------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------- |
| `allow`        | the original value                                                       | –                                  | data the task needs (age, public URLs)                |
| `redact`       | `[EMAIL_REDACTED]`                                                       | **no**, the original is not stored | data the AI never needs                               |
| `tokenize`     | `[EMAIL_001]`                                                            | **yes**, in `release()`            | names and IDs you want back in the answer             |
| `pseudonymize` | a realistic fake: `Avery Collins`, `user4821@example.com`, `+1 555-0142` | yes                                | when the model works better with natural-looking text |
| `block`        | nothing; the **whole request** is refused                                | –                                  | passwords, keys, card numbers under strict policies   |

Example from demo 1 (`default` policy):

```text
ID    TYPE                    CONF   WHERE              ACTION        REPLACEMENT
E1    PERSON                  0.85   chars 8-18         tokenize      [PERSON_001]
E2    EMAIL                   0.95   chars 32-54        tokenize      [EMAIL_001]
E3    PHONE                   0.90   chars 71-86        tokenize      [PHONE_001]
E4    PAN                     0.95   chars 98-108       tokenize      [PAN_001]
E5    CREDIT_CARD             0.98   chars 130-149      redact        [CREDIT_CARD_REDACTED]
```

## 2.5 Sessions and tokens

Each `protect()` call creates a **session** unless you pass `sessionId`. The session stores the token → original value mapping.

```ts
const first = await aran.protect({ type: "text", data: "I'm Ravi Kumar" });
first.sessionId; // "ses_TtSRvettj05KevBtRh9gcw"
first.safeData; // "I'm [PERSON_001]"

// Next message in the same conversation: reuse the session
const second = await aran.protect({
  type: "text",
  data: "Ravi Kumar here again",
  sessionId: first.sessionId,
});
second.safeData; // "[PERSON_001] here again"   ← same token
```

Facts about tokens:

- A token contains **only the type and a counter**, never any part of the value. `[PERSON_001]` is used, never `[Ravi_001]`.
- Within one session, the same value always gets the same token. `+91 98765 43210` and `9876543210` count as the same phone number.
- Tokens are restored **only within their own session**. The session ID is random (128 bits) and cannot be guessed.
- Sessions expire after **1 hour** by default (`sessionTtlMs`). Each use extends the expiry.
- `await aran.destroySession(id)` deletes a session's mappings immediately.
- With `retention: "zero"`, mappings are deleted right after `release()`.
- If the user's text already contains something like `[PERSON_001]`, ARAN numbers its own tokens differently to avoid a collision, and warns with `TOKEN_COLLISION_AVOIDED`.

## 2.6 Status: safe, uncertain, blocked

**Always check `result.status` before using `safeData`.**

| Status        | Meaning                                                                                                                                                           | `safeData`                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `"safe"`      | Everything was inspected and protected according to the policy.                                                                                                   | the protected payload                                                   |
| `"blocked"`   | The policy says `block` for something that was found. Nothing should be sent.                                                                                     | `null`                                                                  |
| `"uncertain"` | Some content could **not** be fully inspected: OCR failed or is unavailable, a PDF page couldn't be read, a DOCX contains an embedded object, a detector crashed. | **fail-closed:** `null`. **fail-open:** best-effort data plus warnings. |

Recommended pattern:

```ts
const result = await aran.protect(input);

if (result.status === "blocked") {
  // Tell the user which kind of data is not allowed. Type names are safe to show.
  throw new Error(`Not allowed to send: ${result.minimization.blocked.join(", ")}`);
}
if (result.safeData === null) {
  throw new Error("Could not fully check this content; nothing was sent.");
}
if (result.status === "uncertain") {
  // fail-open: you decide. Look at result.warnings.
}
await sendToAI(result.safeData);
```

## 2.7 Fail-open and fail-closed

|                               | Fail-open                                                              | Fail-closed                                            |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| When inspection is incomplete | returns best-effort `safeData` with `status: "uncertain"` and warnings | returns `safeData: null` with `FAIL_CLOSED_WITHHELD`   |
| Default for policies          | `default`, `developer`                                                 | `strict`, `healthcare`, `financial`, `enterprise`      |
| Override                      | `new Aran({ failMode: "open" })`                                       | `new Aran({ failMode: "closed" })` or `mode: "strict"` |

Real example from demo 4, a scanned PDF with OCR turned off under `healthcare` (fail-closed):

```text
status: uncertain | safeData: null
Warnings:
  [error] OCR_UNAVAILABLE (page 1): OCR is unavailable; text inside the image was not inspected. OCR is disabled in the ARAN configuration.
  [error] FAIL_CLOSED_WITHHELD: Content could not be fully inspected; protected data was withheld (fail-closed).
```

`mode: "strict"` additionally lowers the detection threshold (to at most 0.35, so more borderline matches are protected) and turns on OCR verification of sanitized PDFs.

## 2.8 The ProtectionResult, field by field

```ts
const result = await aran.protect({ type: "text", data: "..." });
```

| Field              | Type                                   | Description                                                                                                                                                         |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`        | `string`                               | Use it in `release()` / `restore()` and to continue the conversation.                                                                                               |
| `requestId`        | `string`                               | Unique ID for this call; it appears in logs and audit events.                                                                                                       |
| `type`             | `"text" \| "image" \| "pdf" \| "docx"` | Echo of the input type.                                                                                                                                             |
| `status`           | `"safe" \| "uncertain" \| "blocked"`   | See 2.6.                                                                                                                                                            |
| `safeData`         | depends on type (2.3), or `null`       | **The only thing to send to an AI.**                                                                                                                                |
| `protectedData`    | same as `safeData`                     | Alias.                                                                                                                                                              |
| `detectedEntities` | `DetectedEntity[]`                     | One item per finding: `id`, `type`, `confidence`, `source`, `start`/`end`/`length` (text offsets), `page` (PDF), `boundingBox` (images and PDF OCR). **No values.** |
| `actions`          | `ProtectionAction[]`                   | For each entity: `action`, `replacement` (token or marker), `reason` (`"policy"`, `"purpose"` or `"default"`), `restorable`.                                        |
| `warnings`         | `Warning[]`                            | `code`, `message`, `severity` (`info`/`warning`/`error`), `page?`, `incomplete?`. See [chapter 11](11-troubleshooting-and-faq.md).                                  |
| `minimization`     | object                                 | `purpose`, `matchedRule`, `reason`, plus lists of types `removed`, `retained`, `tokenized` and `blocked`.                                                           |
| `summary`          | object                                 | `total`, `counts` per type, `riskLevel` (`NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).                                                                              |
| `policy`           | `string`                               | Name of the policy used.                                                                                                                                            |
| `metadata`         | object                                 | `processingTimeMs`, `detectorVersions`, `failMode`, `language?`, `pages?`.                                                                                          |

Risk levels:

| Risk       | When                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| `CRITICAL` | any secret or credential (password, API key, token, private key, DB URL) |
| `HIGH`     | government, financial or health identifiers                              |
| `MEDIUM`   | personal identity data (name, email, phone, address, …)                  |
| `LOW`      | only network or demographic data (IPs, age)                              |
| `NONE`     | nothing found                                                            |

> Offsets (`start`/`end`) refer to the input text. For JSON input they refer to the individual field's string; for PDFs, to that page's text; for images, to the OCR text.

## 2.9 The ReleaseResult, field by field

```ts
const released = await aran.release(aiAnswerText, result.sessionId);
```

| Field                                                 | Description                                                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                              | `"safe"`, `"warned"` (the output contained new sensitive data and the policy says _warn_), or `"blocked"` (the output policy withheld the answer). |
| `data`                                                | The final text for your app, with tokens restored, or `null` if blocked.                                                                           |
| `restoredTokens`                                      | How many tokens were turned back into values.                                                                                                      |
| `unrestoredTokens`                                    | Tokens left as-is: unknown, from another session, or not restorable by policy.                                                                     |
| `detectedEntities`                                    | New sensitive values found in the AI's answer (`location: "output"`).                                                                              |
| `actions`                                             | What the output policy did to each of them.                                                                                                        |
| `warnings`                                            | e.g. `OUTPUT_SENSITIVE_DATA`, `UNKNOWN_TOKEN`, `NO_SESSION`.                                                                                       |
| `sessionId`, `requestId`, `metadata.processingTimeMs` | Bookkeeping.                                                                                                                                       |

`restore(text, sessionId)` is a shortcut that returns just the text. It throws `BlockedError` if the output was blocked and `RestorationError` if the session is unknown or expired.

## 2.10 Method reference

| Method                                | Returns                                                                          | Use it to                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `protect(input)`                      | `ProtectionResult`                                                               | detect and protect, creating or continuing a session             |
| `scan(input)`                         | `ScanResult` (`status: "complete" \| "incomplete"`, entities, summary, warnings) | find out what's in the data **without changing it** (no session) |
| `release(response, sessionId?)`       | `ReleaseResult`                                                                  | scan the AI's answer and restore tokens                          |
| `restore(response, sessionId)`        | `string`                                                                         | the same, returning text only (throws on block)                  |
| `generate(provider, input, options?)` | `{ text, protection, release, response }`                                        | protect → call AI → release in one call                          |
| `destroySession(sessionId)`           | `boolean`                                                                        | delete a session's mappings now                                  |
| `dispose()`                           | `void`                                                                           | delete everything and stop OCR workers                           |
| `entities.register({...})`            | definition                                                                       | add your own entity type (chapter 7)                             |
| `addDetector(detector)`               | `this`                                                                           | add a custom detector, e.g. an ML model                          |
| `activeSessions`                      | `number`                                                                         | how many sessions currently exist                                |
| `policy`, `failMode`                  | read-only                                                                        | the resolved policy and fail mode in use                         |

## 2.11 What ARAN never does

- It never sends your data anywhere. Only provider calls you make go over the network.
- It never puts original values in results, warnings, errors, logs or audit events.
- It never writes temporary files.
- It never claims content is safe when it could not inspect it.
- It never stores mappings on disk unless you plug in your own store, and then it encrypts them if you provide a key.

---

← [1. Installation](01-installation-and-setup.md) · Next: [3. Text and JSON →](03-text-and-json.md)
