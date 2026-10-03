# Architecture

ARAN is a library. All processing happens inside the calling Node.js process; there is no ARAN service.

## Request lifecycle

```text
protect(input)
  ├─ validateInputShape            type/data/purpose checks
  ├─ session: create or reuse      random 128-bit id, per-session HMAC key
  ├─ ProtectionContext             per-request state: deadline, warnings, entities, actions
  ├─ format handler                text | image | pdf | docx
  │    └─ for each text segment → ctx.processText(text, {page, fieldName, locate})
  │          ├─ DetectionEngine.detect      all detectors in parallel, failures → warnings
  │          │     ├─ drop invalid spans and ARAN's own tokens
  │          │     └─ resolve overlaps      confidence + category priority, longer span on ties
  │          ├─ field hints                 {"email": "…"} → EMAIL
  │          ├─ PolicyEngine.decide         threshold → purpose rule → entity rule → default
  │          ├─ replacement per decision    redact marker | token | pseudonym | (allow)
  │          └─ applyReplacements           single pass, offsets never shift
  ├─ status                        blocked > uncertain (incomplete) > safe
  ├─ fail-closed                   uncertain → safeData = null
  └─ ProtectionResult              value-free metadata + safeData
```

`release(response, sessionId)` runs the output pipeline:

1. Detect entities in the response. ARAN tokens and session pseudonyms are excluded.
2. Ignore types the policy allows in input, such as `AGE` or public `URL`.
3. Apply the output action (`allow | warn | redact | tokenize | block`) to every other entity.
4. If not blocked, restore tokens and pseudonyms that are restorable under the policy.
5. With `retention: "zero"`, destroy the session.

Restoration runs **after** scanning, so restored originals are never mistaken for leaks.

## Format handlers

Every handler reduces its input to text segments and sends them through the same `processText`, so detection and policy behave identically across formats.

| Handler | Segments                                                                                                                     | Location mapping                                                   | Output                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| text    | the string, or each string value/key of an object                                                                            | character offsets                                                  | same shape as input                                                 |
| image   | OCR text (words joined by spaces, lines by newlines)                                                                         | word bounding boxes, one box per line                              | PNG with boxes painted over; EXIF stripped                          |
| pdf     | page text layer; OCR text for scanned pages and image regions                                                                | text-item geometry (interpolated per character) and OCR word boxes | per-page text; in document mode, a new PDF of flattened page images |
| docx    | one stream per part and per node kind (`w:t`, `w:delText`, `w:instrText`, `a:t`, `m:t`), plus text attributes and custom XML | text-node offsets                                                  | the original package with only text nodes and attributes rewritten  |

### DOCX replacement

Word frequently splits a single value across runs (`<w:t>Ra</w:t><w:t>vi</w:t>`). ARAN joins all text nodes of a part into one stream (paragraph ends become `\n`, tabs `\t`), detects on the stream, and writes each replacement into the **first** node it overlaps, removing the covered characters from the following nodes. Run properties, paragraphs, tables and numbering are untouched.

### PDF document mode

Redacting a PDF in place is error-prone: text can survive in content streams, fonts, annotations, form fields, metadata, incremental updates and attachments. ARAN instead renders each page, paints over sensitive regions, and assembles a new PDF containing only those images. The result cannot leak hidden text, at the cost of text selectability.

## Sessions and mappings

```text
Session
  id            ses_<22 chars base64url>   (128 bits)
  key           32 random bytes (Buffer, zeroed on destroy)
  index         HMAC(key, type ‖ normalized value) → token
  counters      per entity type; skips tokens already present in input
  keys          store keys owned by the session (for cleanup)
  pseudonyms    pseudonym → store key

MappingStore    key = "<sessionId>:<token>" → { entityType, value, restorable, createdAt, expiresAt, encrypted? }
```

Stores: `MemoryMappingStore` (default), `EncryptedMappingStore` wrapping any store (AES-256-GCM, AAD = `aran:v1|key|type|restorable`), or your own `MappingStore` (always wrapped in encryption when `encryptionKey` is set).

## Detection

- `RegexDetector` is generic. It handles capture groups, validators, multilingual context keywords (boost or require), negative context, dynamic classification (URL vs INTERNAL_URL) and Unicode-aware boundaries.
- `createPiiDetector()` and `createSecretDetector()` are configured instances.
- `HeuristicNerDetector` finds persons (titles, labels, cues, known given names, Hindi/Tamil cues), addresses (street patterns, labels, PIN/ZIP) and healthcare providers.
- Custom detectors are any object implementing `Detector`. Language-specific detectors declare `languages` and are skipped for text in other scripts (mixed-script text runs all detectors).

## Extensibility points

| Interface                  | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `Detector` / `NerDetector` | add detection strategies (ML NER, domain IDs)                 |
| `aran.entities.register()` | custom entity types with regex, options or function detectors |
| `OcrEngine`                | alternative local OCR backends                                |
| `FaceDetector`             | face redaction in images, scanned PDFs and DOCX images        |
| `MappingStore`             | external mapping storage (encrypted by ARAN)                  |
| `AIProvider`               | any model API; `stream()` is reserved for future streaming    |
| `Logger`, `AuditSink`      | observability (fields are sanitized)                          |

## Future work (not in V1)

The interfaces are designed so these can be added without breaking changes: streaming release (buffering partial tokens at chunk boundaries), additional formats (CSV, XLSX, audio, video, DICOM) as new handlers producing text segments and regions, a REST gateway or Python SDK on top of the same policy format, and centrally managed policies.
