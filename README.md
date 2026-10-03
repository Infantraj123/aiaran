# ARAN — AI Privacy SDK for Node.js

ARAN is an open-source, local-first AI privacy SDK for Node.js that detects, minimizes, anonymizes and protects sensitive information before it is sent to AI models. ARAN supports text, images, PDFs and Word documents and is designed to work with multiple AI providers.

ARAN provides technical controls intended to reduce sensitive-data exposure. It does not guarantee complete privacy, does not detect every piece of personal data, and does not by itself make a system compliant with HIPAA, GDPR, DPDP or any other regulation. See [Limitations](#14-limitations).

```bash
npm install aiaran
```

```ts
import { Aran } from "aiaran";

const aran = new Aran();
const result = await aran.protect({
  type: "text",
  data: "My name is John and my email is john@example.com",
});

console.log(result.safeData);
// "My name is [PERSON_001] and my email is [EMAIL_001]"
```

> The npm package is `aiaran`; the project, class (`Aran`) and CLI (`aran`) are named ARAN.

**📘 New here? Read the step-by-step [User Guide](docs/guide/README.md)**: installation, text, images, PDF, Word, policies, AI providers, CLI and production, with [runnable demos](demos/README.md) for everything.

---

## Contents

1. [What ARAN is](#1-what-aran-is)
2. [Why it exists](#2-why-it-exists)
3. [Architecture](#3-architecture)
4. [Installation](#4-installation)
5. [Quick start](#5-quick-start)
6. [Text](#6-text)
7. [Images](#7-images)
8. [PDF](#8-pdf)
9. [DOCX](#9-docx)
10. [Policies](#10-policies)
11. [AI integration](#11-ai-integration)
12. [Security model](#12-security-model)
13. [Threat model](#13-threat-model)
14. [Limitations](#14-limitations)
15. [Supported formats](#15-supported-formats)
16. [Contributing](#16-contributing)
17. [License](#17-license)

---

## 1. What ARAN is

ARAN is a privacy layer that sits between your application and an AI model. It is more than a PII regex library. It combines:

- **Detection**: pattern detectors with checksum validation (Luhn, Verhoeff, IBAN mod-97), secret and credential detection, and local name and address heuristics. It understands English, Hindi and Tamil cues, and you can plug in your own detectors.
- **Policy**: built-in and custom YAML/JSON policies decide, per entity type, whether to `allow`, `redact`, `tokenize`, `pseudonymize` or `block`.
- **Data minimization**: a request's stated _purpose_ can switch to a stricter rule set, and ARAN tells you exactly what it removed, kept, tokenized or blocked.
- **Reversible protection**: `John Smith` becomes `[PERSON_001]`. When the AI answers, ARAN restores the original values for the tokens the policy allows.
- **Multimodal processing**: text, structured JSON, images (local OCR), text and scanned PDFs, and DOCX.
- **Output protection**: AI responses are scanned for sensitive values that ARAN did not put there, and the output policy is applied before anything is restored.
- **Provider abstraction**: optional adapters for OpenAI, Anthropic, Google Gemini, Ollama and any OpenAI-compatible server.

Everything runs in your process. ARAN has no cloud service and never uploads your data anywhere.

## 2. Why it exists

Prompts, uploaded documents and screenshots routinely contain names, phone numbers, government IDs, medical record numbers, API keys and database passwords. Once that data reaches a third-party model it is out of your control: it may be logged, retained, or used in ways your users never agreed to.

Most AI tasks don't need those values. A model can summarize a discharge note without knowing the patient's name, and it can explain a stack trace without the database password. ARAN removes or replaces what isn't needed, keeps what is, and puts the originals back afterwards, all without changing your application's structure.

## 3. Architecture

```text
Application
   │
   ▼
ARAN ── validate input (size, magic bytes, limits)
   │ ── extract text (text layer, local OCR, DOCX XML)
   │ ── detect (PII · secrets · NER heuristics · custom)  → merge overlaps
   │ ── apply policy (+ purpose-based minimization)        → explainable decisions
   │ ── redact / tokenize / pseudonymize / block
   │ ── build safe payload (text, redacted image, flattened PDF, sanitized DOCX)
   ▼
AI provider (OpenAI · Anthropic · Gemini · Ollama · any)
   │
   ▼
ARAN ── scan response for unexpected sensitive data → output policy
   │ ── restore permitted tokens (session-scoped)
   ▼
Application
```

Source layout:

| Directory         | Responsibility                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `src/core`        | `Aran` class, per-request pipeline context, sessions, release pipeline, typed errors        |
| `src/detection`   | Detector interface, regex/PII/secret detectors, heuristic NER, validators, detection engine |
| `src/entities`    | Entity model, built-in entity catalogue, registry for custom types                          |
| `src/policy`      | Policy types, built-in policies, YAML/JSON loader and validator, policy engine              |
| `src/protection`  | Tokenizer, pseudonymizer, redaction, encrypted mapping store                                |
| `src/restoration` | Mapping store interface, token restorer                                                     |
| `src/formats`     | Text/JSON, image, PDF and DOCX handlers                                                     |
| `src/ocr`         | OCR interface and local Tesseract engine                                                    |
| `src/providers`   | AI provider interface and adapters                                                          |
| `src/security`    | Limits, timeouts, file validation, AES-256-GCM, hashing, SSRF helpers                       |
| `src/logging`     | Allowlist-based logger and audit events                                                     |
| `src/cli`         | `aran` command-line tool                                                                    |

Read [docs/architecture.md](docs/architecture.md) for the design in depth.

## 4. Installation

```bash
npm install aiaran
```

Requires Node.js 20.19 or later (tested on Node 20, 22 and 24).

Text protection has two small dependencies (`yaml` and `fflate`). Heavier features use **optional peer dependencies**, so you install only what you need:

| Feature                                  | Install                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Images (decode, redact, strip EXIF)      | `npm install sharp`                                                                  |
| OCR (images, scanned PDFs)               | `npm install tesseract.js @tesseract.js-data/eng`                                    |
| Extra OCR languages                      | e.g. `@tesseract.js-data/hin`, `@tesseract.js-data/tam` (see note below)             |
| PDF text extraction and rendering        | `npm install pdfjs-dist` (≥ 6.2.108 on Node 22+; 5.6.x on Node 20 — see SECURITY.md) |
| PDF document mode (sanitized PDF output) | `npm install pdfjs-dist pdf-lib`                                                     |
| Anthropic provider                       | `npm install @anthropic-ai/sdk`                                                      |

OpenAI, Gemini, Ollama and generic OpenAI-compatible providers need no extra package; they use `fetch`.

If a feature's dependency is missing, ARAN raises a `DependencyMissingError` with the exact install command. It never silently skips the feature.

**OCR is local-only by default.** ARAN loads language data from installed `@tesseract.js-data/<lang>` packages. If none is installed it reports OCR as unavailable rather than downloading models. To use several languages, put the `.traineddata` files in one directory and pass `ocr: { languages: ["eng", "hin", "tam"], langPath: "/path/to/tessdata" }`. Alternatively, set `ocr: { allowModelDownload: true }` to let tesseract.js fetch models (only model files are downloaded; images are never uploaded).

## 5. Quick start

```ts
import { Aran } from "aiaran";

const aran = new Aran({ policy: "healthcare", mode: "strict" });

const protectedInput = await aran.protect({
  type: "text",
  data: `
    Patient John Smith,
    patient ID P123456,
    age 52,
    blood pressure 150/95.
  `,
});

console.log(protectedInput.safeData);
//   Patient [PERSON_001],
//   patient ID [PATIENT_ID_001],
//   age 52,
//   blood pressure 150/95.

// ...send protectedInput.safeData to your model, then:
const restored = await aran.restore(aiResponseText, protectedInput.sessionId);
```

Every `protect()` call returns a `ProtectionResult`:

```ts
{
  sessionId: "ses_…",            // use it to restore tokens or continue a conversation
  requestId: "req_…",
  type: "text",
  status: "safe",                // "safe" | "uncertain" | "blocked"
  safeData: "...",               // the ONLY payload to send to an AI (null if blocked/withheld)
  protectedData: "...",          // alias of safeData
  detectedEntities: [            // no values, only types, offsets, confidence
    { id: "E1", type: "PERSON", start: 13, end: 23, length: 10, confidence: 0.85, source: "ner" }
  ],
  actions: [{ entityId: "E1", entityType: "PERSON", action: "tokenize", replacement: "[PERSON_001]", reason: "policy", restorable: true }],
  warnings: [],
  minimization: { removed: [], retained: ["AGE"], tokenized: ["PERSON", "PATIENT_ID"], blocked: [], reason: "No purpose provided; base policy applied." },
  summary: { total: 3, counts: { PERSON: 1, PATIENT_ID: 1, AGE: 1 }, riskLevel: "HIGH" },
  policy: "healthcare",
  metadata: { processingTimeMs: 4, detectorVersions: { "aran.pii": "1.0.0", … }, failMode: "closed" }
}
```

**Always check `status`:**

- `safe`: everything was inspected and protected.
- `blocked`: the policy blocked the request (for example, a password under the `strict` policy). `safeData` is `null`.
- `uncertain`: something could not be fully inspected, such as an OCR failure or an unreadable page. In **fail-closed** mode `safeData` is `null`. In **fail-open** mode you get best-effort data plus warnings, and you decide whether to continue.

## 6. Text

```ts
// Plain strings
await aran.protect({ type: "text", data: "Call Ravi on +91 98765 43210" });
// → "Call [PERSON_001] on [PHONE_001]"

// JSON-compatible objects. String values (and keys) are protected, structure is kept,
// and field names act as hints: { "email": "…" } is treated as EMAIL.
await aran.protect({
  type: "text",
  data: { name: "Kiran", contact: { email: "kiran@example.com", phone: 9876543210 }, age: 41 },
});
// → { name: "[PERSON_001]", contact: { email: "[EMAIL_001]", phone: "[PHONE_001]" }, age: 41 }

// Multi-turn conversations: reuse the session so values keep the same token
const t1 = await aran.protect({ type: "text", data: "I'm Emily Carter" });
const t2 = await aran.protect({
  type: "text",
  data: "Emily Carter again",
  sessionId: t1.sessionId,
});
// both use [PERSON_001]

// Purpose-based minimization
const r = await aran.protect({
  type: "text",
  data: note,
  purpose: "Analyze cardiovascular risk",
});
r.minimization;
// { purpose: "Analyze cardiovascular risk", matchedRule: "clinical-analysis",
//   removed: ["PERSON", "PATIENT_ID", "PHONE"], retained: ["AGE"], tokenized: [], blocked: [], reason: "…" }

// Detection only, with no session and no changes
const scan = await aran.scan({ type: "text", data: note });
scan.summary; // { total, counts, riskLevel }
```

## 7. Images

```ts
import { readFile } from "node:fs/promises";

const result = await aran.protect({
  type: "image",
  data: await readFile("screenshot.png"),
  filename: "screenshot.png", // optional; checked against the file's real content
});

if (result.status === "safe") {
  result.safeData.image; // PNG with sensitive regions painted over; EXIF/GPS stripped
  result.safeData.text; // sanitized OCR text
  result.detectedEntities; // each entity includes a boundingBox
}
```

PNG, JPEG, WebP and TIFF are supported. ARAN runs OCR locally, maps each detected entity back to word bounding boxes, and paints opaque boxes over them, labelled with the token where it fits. Faces are redacted only if you configure a `faceDetector`; otherwise the result carries a `FACES_NOT_INSPECTED` notice.

## 8. PDF

```ts
const pdf = await readFile("report.pdf");

// Content mode (default): sanitized text, per page
const content = await aran.protect({ type: "pdf", data: pdf });
content.safeData.text;
content.safeData.pages; // [{ page: 1, text: "...", source: "text" | "ocr" }]

// Document mode: also returns a sanitized PDF
const doc = await aran.protect({ type: "pdf", data: pdf, mode: "document" });
if (doc.status === "safe" && doc.safeData.document) {
  await writeFile("report.safe.pdf", doc.safeData.document);
}
```

- **Text PDFs** use the embedded text layer.
- **Scanned PDFs** (pages with little or no text) are rendered and OCR'd locally. Pages with embedded images are OCR'd too, so text inside images is not missed.
- **Document mode** rebuilds the PDF from rendered page images with the sensitive regions painted over. The output has **no text layer, metadata, annotations, form fields, attachments or JavaScript**, so redacted text cannot be recovered by copy/paste or by inspecting the file. The trade-off is that text in the sanitized PDF is no longer selectable.
- In `strict` mode, ARAN re-OCRs each redacted page and flags any remaining sensitive text (`PDF_VERIFICATION_FAILED`).
- If any page cannot be inspected or rendered, ARAN returns `status: "uncertain"` with a warning for that page. It **never returns a sanitized PDF unless every page was processed**.

Password-protected PDFs are rejected with `UnsupportedFormatError`.

## 9. DOCX

```ts
const docx = await readFile("letter.docx");

const result = await aran.protect({ type: "docx", data: docx, mode: "document" });
result.safeData.text; // sanitized text
result.safeData.document; // sanitized .docx
```

ARAN rewrites text inside the original runs, so paragraphs, headings, tables, lists and formatting are preserved. A value split across several runs (common when Word spell-checks) is still found and replaced. Beyond the body, ARAN also sanitizes:

- headers, footers, footnotes, endnotes and comments
- tracked deletions and field codes
- hyperlink targets (such as `mailto:` links) and image alt text
- chart and SmartArt text, and custom XML data parts
- document properties (author, last modified by, title, company) and comment or revision author names
- embedded PNG/JPEG images, which are OCR'd and redacted (EXIF stripped)

ARAN never silently skips content. Any content it cannot inspect produces an explicit warning and `status: "uncertain"`. This covers embedded OLE objects, EMF/WMF images, altChunk HTML/RTF, and text hidden in CDATA sections. Legacy binary `.doc` files and macro-enabled `.docm` files are rejected with `UnsupportedFormatError`; convert `.doc` to `.docx` first.

## 10. Policies

Built-in policies:

| Policy       | Fail mode | Summary                                                                                                                                                   |
| ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`    | open      | Tokenize personal identifiers; redact secrets, card numbers and DOB; allow age and public URLs                                                            |
| `strict`     | closed    | Lower detection threshold; block secrets and card numbers; redact government IDs and addresses                                                            |
| `healthcare` | closed    | Tokenize patient identity; redact contact details; block payment data and secrets; purpose rules for clinical analysis, patient communication and billing |
| `financial`  | closed    | Tokenize account identifiers; block card numbers and secrets                                                                                              |
| `developer`  | open      | For code and logs: redact credentials, tokenize people and infrastructure                                                                                 |
| `enterprise` | closed    | Block secrets, hide internal infrastructure, tokenize people                                                                                              |

Custom policies can be written as a shorthand object, a full definition, or YAML/JSON:

```ts
// Shorthand (inherits everything else from "default")
new Aran({ policy: { PERSON: "tokenize", EMAIL: "redact", CREDIT_CARD: "block" } });
```

```yaml
# clinic.yaml
name: clinic
extends: healthcare # inherit unspecified settings
failMode: closed
minConfidence: 0.5
entities:
  PERSON:
    action: tokenize
  EMAIL: redact
  PHONE: redact
  PATIENT_ID:
    action: tokenize
    restore: false # tokenize, but never restore in AI output
  CREDIT_CARD: block
  PASSWORD: block
output:
  restoreTokens: true
  unexpectedEntityAction: redact # allow | warn | redact | tokenize | block
purposes:
  - id: cardiology
    keywords: [cardio, heart, blood pressure]
    entities:
      PERSON: redact
      PATIENT_ID: redact
      AGE: allow
```

```ts
import { loadPolicyFile } from "aiaran";
const aran = new Aran({ policy: await loadPolicyFile("clinic.yaml") });
```

```bash
aran policy validate clinic.yaml
```

YAML is parsed with the safe core schema (no custom tags, limited aliases). Prototype keys are rejected and actions are case-insensitive. See [docs/policies.md](docs/policies.md) for the full reference.

**Custom entities:**

```ts
aran.entities.register({ name: "EMPLOYEE_ID", detector: /\bEMP-\d{5}\b/ });

aran.entities.register({
  name: "CASE_NUMBER",
  defaultAction: "redact",
  detector: { pattern: /\b\d{6}\b/, context: { keywords: ["case", "मामला"], required: true } },
});
```

You can also pass a full `Detector` implementation, for example an adapter around a local NER model, through `new Aran({ detectors: [...] })` or `aran.addDetector()`.

## 11. AI integration

The simplest way is `generate()`. It protects the input, sends only the safe payload, scans the response and restores tokens:

```ts
import { Aran, OpenAIProvider, AnthropicProvider, OllamaProvider } from "aiaran";

const aran = new Aran({ policy: "healthcare" });
const provider = new AnthropicProvider({ model: "claude-opus-5-5" }); // reads ANTHROPIC_API_KEY

const { text, protection, release } = await aran.generate(
  provider,
  { type: "text", data: note, purpose: "summarize medical condition" },
  { system: "You are a clinical documentation assistant." },
);
```

`generate()` never calls the provider when the request is blocked, or when inspection was incomplete under fail-closed mode.

To manage the AI call yourself:

```ts
const p = await aran.protect({ type: "text", data: userInput });
if (p.status === "blocked" || p.safeData === null) throw new Error("Not safe to send");

const aiText = await myModel(p.safeData); // your own client
const released = await aran.release(aiText, p.sessionId);
released.data; // restored text (or null if the output policy blocked it)
released.warnings; // e.g. OUTPUT_SENSITIVE_DATA if the model produced new PII
```

Available adapters (none is a required dependency):

| Adapter                    | Notes                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `OpenAIProvider`           | Chat Completions; reads `OPENAI_API_KEY`                                                    |
| `OpenAICompatibleProvider` | Any compatible server: `baseURL`, optional key, `maxTokensParam`                            |
| `AnthropicProvider`        | Uses the official `@anthropic-ai/sdk` (optional peer); reads the SDK's standard credentials |
| `GeminiProvider`           | `generateContent`; reads `GEMINI_API_KEY` / `GOOGLE_API_KEY`                                |
| `OllamaProvider`           | Local Ollama (`http://localhost:11434`)                                                     |
| `createProvider(name, fn)` | Wrap any function or internal gateway                                                       |

Model names are always supplied by you; ARAN does not hard-code any. The `AIProvider` interface reserves a `stream()` method for future streaming support. V1 is non-streaming.

## 12. Security model

- **Local-first.** Detection, OCR, rendering and redaction run in your process. ARAN has no network code apart from the provider adapters you explicitly call.
- **Value-free results.** Entities, actions, summaries, warnings, logs, audit events and error messages never contain original values. Tokens (`[PERSON_001]`) contain only the type and a counter.
- **Session-scoped mappings.** Token-to-value mappings live in memory by default, are scoped to an unguessable session ID, expire after one hour (configurable), and can be destroyed at any time with `destroySession()`. With `retention: "zero"` they are destroyed immediately after release.
- **Encrypted storage.** `mappingStore: "encrypted-memory"`, or any custom store combined with `encryptionKey`, encrypts every original value with AES-256-GCM. The storage key, entity type and restore flag are bound as authenticated data. The session index stores HMAC-SHA-256 fingerprints, not values.
- **Logging by allowlist.** The logger only accepts known non-sensitive fields: IDs, counts, timings and policy names. Everything else is dropped, including fields passed to your own logger.
- **Fail-closed when it matters.** The `strict`, `healthcare`, `financial` and `enterprise` policies withhold data when inspection is incomplete.
- **Untrusted file handling.** ARAN checks magic bytes and ignores extensions and declared MIME types. It enforces limits on size, page count, image dimensions and pixel count, decompression size, compression ratio, ZIP entry count, object depth and processing time. ZIP entries with unsafe paths, XML DTDs, macro documents, PDF scripting (`isEvalSupported: false`) and prototype-polluting keys are all rejected. Uploaded documents are never executed or written to disk.
- **SSRF helpers.** V1 does not fetch URLs. `assertPublicUrl()` and `classifyHost()` are provided for any future URL ingestion; they block loopback, private, link-local, CGNAT, cloud metadata and internal DNS names, and check every resolved address.

The full design is in [SECURITY.md](SECURITY.md) and [docs/threat-model.md](docs/threat-model.md).

## 13. Threat model

ARAN is designed to reduce:

- accidental disclosure of personal, financial, health and credential data to AI providers
- sensitive data persisting in provider logs, retention or training pipelines
- sensitive values echoed back, or invented, in AI responses
- leakage through document metadata, hidden PDF text layers, tracked changes and EXIF data
- leakage through ARAN's own logs, errors and audit trail

ARAN does **not** protect against:

- a compromised host or application. ARAN runs in your process, and anyone who controls it controls ARAN.
- sensitive data that the detectors do not recognize (see Limitations)
- re-identification from the context that remains (rare conditions, unique job titles, small populations)
- what the provider does with the protected payload
- data you send to the provider outside ARAN

Details: [docs/threat-model.md](docs/threat-model.md).

## 14. Limitations

Be explicit about these when you deploy ARAN:

- **Detection is not perfect.** Pattern detectors are precise for structured identifiers such as cards, Aadhaar, PAN, IBAN, emails and keys. Names and addresses come from local heuristics that rely on cues ("Mr.", "Name:", "Patient …", street suffixes, PIN/ZIP codes) and will miss names that appear without any cue. For higher recall, plug in a model-based `NerDetector`.
- **Languages.** Context keywords and name cues cover English, Hindi and Tamil. Other languages get the language-independent detectors (emails, numbers, keys and so on) but no name or address heuristics.
- **OCR quality** depends on resolution, fonts and noise. Low-confidence OCR is reported, and very low confidence marks the result `uncertain`. Handwriting is not reliably recognized.
- **Faces** are only redacted if you provide a `FaceDetector`.
- **PDF document mode** produces image-only pages, so text is no longer selectable and file size may grow. PDF form fields and annotations are not rendered into the output.
- **DOCX:** embedded OLE objects, EMF/WMF images and altChunk content are not inspected. They are reported as `uncertain` rather than removed. `.doc` and `.docm` files are not supported.
- **Memory.** JavaScript strings cannot be reliably wiped. ARAN zeroes the key material it holds in Buffers, but original values may remain in heap memory until garbage collection.
- **Compliance.** ARAN is a technical control. It is not a certification, and using it does not by itself make a system HIPAA, GDPR or DPDP compliant.

## 15. Supported formats

| Input                                | `type`  | Detection source                                   | Output                                                  |
| ------------------------------------ | ------- | -------------------------------------------------- | ------------------------------------------------------- |
| Plain text, JSON strings, logs, code | `text`  | Direct                                             | Protected string                                        |
| JSON-compatible objects and arrays   | `text`  | String values, keys, field-name hints              | Protected object (same shape)                           |
| PNG, JPEG, WebP, TIFF                | `image` | Local OCR (+ optional face detector)               | Redacted PNG + sanitized text                           |
| PDF (text)                           | `pdf`   | Text layer (+ OCR of embedded images)              | Sanitized text per page; sanitized PDF in document mode |
| PDF (scanned)                        | `pdf`   | Rendered page OCR                                  | Same                                                    |
| DOCX                                 | `docx`  | WordprocessingML text, attributes, embedded images | Sanitized text; sanitized DOCX in document mode         |
| DOC (legacy)                         | –       | Rejected with `UnsupportedFormatError`             | –                                                       |

Detected entity types: `PERSON`, `EMAIL`, `PHONE`, `ADDRESS`, `DATE_OF_BIRTH`, `USERNAME`, `AGE`, `FACE`, `AADHAAR`, `PAN`, `PASSPORT`, `DRIVER_LICENSE`, `NATIONAL_ID`, `SSN`, `CREDIT_CARD`, `BANK_ACCOUNT`, `IBAN`, `UPI_ID`, `TRANSACTION_ID`, `PASSWORD`, `API_KEY`, `ACCESS_TOKEN`, `JWT`, `PRIVATE_KEY`, `SECRET`, `DATABASE_URL`, `AWS_ACCESS_KEY`, `GITHUB_TOKEN`, `PATIENT_ID`, `MEDICAL_RECORD_NUMBER`, `INSURANCE_ID`, `HEALTHCARE_PROVIDER`, `IP_ADDRESS`, `MAC_ADDRESS`, `URL`, `INTERNAL_URL`, plus any custom types you register. Run `aran entities list` for descriptions, or see [docs/detection.md](docs/detection.md).

### CLI

```text
$ aran scan report.pdf

ARAN Privacy Scanner

PERSON                  3
EMAIL                   2
PHONE                   1
PATIENT_ID              1

Risk level: HIGH

No sensitive values displayed.
```

```bash
aran scan <file|->                       # counts + risk level, never values
aran protect <file> [--mode document]    # writes <name>.protected.<ext>
aran protect notes.txt --policy clinic.yaml --out safe.txt
aran policy validate policy.yaml
aran policies list | aran entities list | aran providers list
```

Exit codes for `protect`: `0` success, `3` blocked by policy, `4` withheld because inspection was incomplete (fail-closed), `1` error. The CLI does not persist token mappings, so tokens in protected files cannot be restored.

### Docker

[examples/docker](examples/docker) contains a Dockerfile that runs the CLI with OCR fully offline:

```bash
docker build -f examples/docker/Dockerfile -t aran .
docker run --rm --network none -v "$PWD:/data" aran scan /data/report.pdf
```

### Configuration reference

```ts
new Aran({
  policy: "default", // name | definition | shorthand
  mode: "balanced", // "strict" forces fail-closed, threshold ≤ 0.35, PDF verification
  failMode: undefined, // override the policy: "open" | "closed"
  minConfidence: undefined, // override the policy threshold
  mappingStore: "memory", // "memory" | "encrypted-memory" | MappingStore
  encryptionKey: undefined, // 32-byte key (Buffer/hex/base64)
  retention: "session", // "zero" destroys mappings after release
  sessionTtlMs: 3_600_000,
  detectors: [], // extra detectors
  disableDetectors: [], // "aran.pii" | "aran.secrets" | "aran.ner-heuristic"
  ocr: { languages: ["eng"] }, // OcrEngine | TesseractEngineOptions | false
  faceDetector: undefined,
  pdf: { ocr: "auto", renderScale: 2, verify: false },
  docx: { inspectImages: true },
  limits: { maxFileBytes: 50 * 1024 * 1024, maxPdfPages: 300, timeoutMs: 120_000 /* … */ },
  concurrency: 2, // concurrent OCR jobs
  logger: undefined, // Logger | false (fields are always sanitized)
  logLevel: "warn",
  audit: (event) => {}, // value-free audit events
});
```

### Benchmarks

`npm run build && npm run bench`. Measured on a developer laptop (Node 24, single process, synthetic data at high entity density):

| Case                                                         | Time                                 |
| ------------------------------------------------------------ | ------------------------------------ |
| 1 KB text                                                    | ~25 ms (first call includes warm-up) |
| 100 KB text (~3,900 entities)                                | ~60 ms                               |
| 1 MB text (~40,000 entities)                                 | ~0.45 s                              |
| 100-page text PDF                                            | ~0.4 s                               |
| 1080p screenshot with OCR                                    | ~0.9 s                               |
| Large DOCX (5,000 paragraphs, document mode)                 | ~0.2 s                               |
| 10 MB PDF, ~88 pages, each with an image (OCR on every page) | ~55 s                                |

OCR dominates the cost of images and scanned documents. See [docs/benchmarks.md](docs/benchmarks.md) for tuning options.

## 16. Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md). Use only synthetic data in code, tests, issues and documentation, and report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run build && npm run pack:check
```

## 17. License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Author

Developed and maintained by **AROCKIA INFANT RAJ M** ([infantraj01012003@gmail.com](mailto:infantraj01012003@gmail.com)).
