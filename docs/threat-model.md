# Threat Model

ARAN provides technical controls intended to reduce sensitive-data exposure when applications use AI models. This document states what it protects against, what it does not, and the residual risks to plan for.

## Assets

1. Sensitive values in user input: personal identifiers, government IDs, financial data, health identifiers, credentials, internal infrastructure.
2. Token mappings that link tokens back to original values.
3. Documents and images that contain such values, including in hidden structures and metadata.

## Trust boundaries

```text
[ User / upstream system ] → [ Application process + ARAN ] → [ AI provider ] → back
                                     ▲ trusted                     ▲ untrusted with respect to raw data
```

ARAN assumes the application process and host are trusted. The AI provider is **not** trusted with raw sensitive values. Input files are **untrusted** and may be malicious. AI output is **untrusted** and may contain sensitive data or attempt to manipulate restoration.

## What ARAN protects against

| Threat                                                                                                                                             | Control                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sensitive values sent to an AI provider                                                                                                            | Detection, policy and replacement; `generate()` refuses to call providers when the request is blocked or incomplete under fail-closed |
| Values unnecessary for the task                                                                                                                    | Purpose-based minimization with an explainable report                                                                                 |
| Model echoing or inventing sensitive data                                                                                                          | Output scanning with `warn`, `redact`, `tokenize` or `block`                                                                          |
| Restoring values into the wrong conversation                                                                                                       | Mappings are scoped to unguessable session IDs; tokens from other sessions are never resolved                                         |
| Forged tokens in input colliding with real ones                                                                                                    | Existing token-like strings are reserved, so new tokens skip those numbers                                                            |
| Restoration of values the policy forbids                                                                                                           | Per-entity `restore: false`, global `restoreTokens: false`, and redaction (never reversible)                                          |
| Hidden document content (PDF text layers, metadata, scripts, attachments; DOCX tracked changes, comments, field codes, alt text, properties; EXIF) | Format-specific sanitization; flattened PDF output; image re-encoding                                                                 |
| Leakage via ARAN's own logs, errors and audit trail                                                                                                | Allowlist logging, value-free errors and events                                                                                       |
| Mapping theft from storage                                                                                                                         | Memory-only by default, TTL, explicit destruction, zero-retention, AES-256-GCM for persisted stores                                   |
| Malicious files: zip bombs, huge images, deep nesting, path traversal, XXE, macros, PDF JavaScript, type confusion                                 | Limits, magic-byte validation, safe parser settings, rejection of DTDs and macros, no execution, no temp files                        |
| ReDoS                                                                                                                                              | Bounded patterns, tested against adversarial input; per-request timeout                                                               |
| Prototype pollution                                                                                                                                | Dangerous keys dropped from structured input and rejected in policies                                                                 |
| SSRF (future URL ingestion)                                                                                                                        | `assertPublicUrl` blocks private, loopback, link-local and metadata targets and checks every resolved address                         |

## What ARAN does not protect against

- **Compromised application or host.** ARAN runs in-process, with the same privileges as your code.
- **Undetected sensitive data.** Free-text names without cues, unusual identifier formats, sensitive facts that are not identifiers ("the only cardiologist in the village"), images of handwriting, and languages without cue support.
- **Re-identification from retained context.** Quasi-identifiers such as age, location, rare conditions or dates can identify people in combination. Use purpose rules and stricter policies when this matters.
- **Provider behaviour** with the protected payload, including retention, training and logging.
- **Data sent outside ARAN.** For example, a system prompt you write yourself, which ARAN does not scan, or tool calls.
- **Side channels.** Payload length, token counts and timing can reveal approximate structure.
- **Memory forensics.** Original strings may remain in the JavaScript heap until garbage collection.

## Known limitations

- **Detection:** pattern detectors are precise for structured identifiers. Name and address detection is heuristic and cue-based. Confidence thresholds trade recall against false positives.
- **OCR:** accuracy depends on resolution, fonts and noise. Very low confidence marks results `uncertain`. Text in unsupported scripts or handwriting may be missed.
- **Faces:** inspected only with a configured `FaceDetector`.
- **PDF:** form fields and annotations are not inspected in content mode and are not rendered in document mode. Password-protected PDFs are rejected. Redaction geometry for text layers is interpolated per character and padded, so it may cover slightly more than the value. Optional OCR verification is available.
- **DOCX:** OLE embeddings, EMF/WMF images and altChunk content are reported as not inspected rather than removed. `.doc` and `.docm` are rejected.
- **Output scanning** uses the same detectors as input and inherits their limitations.

## Provider-side risks

Even protected payloads reveal the task, the structure of the document, and any information the policy allows. Choose providers and retention settings accordingly. Use local models (`OllamaProvider`) for the most sensitive workloads.

## Application-side risks

- Sending `result.safeData` only when `status` is `safe` is the application's responsibility. `generate()` enforces this for you.
- Logging `safeData` is usually acceptable. Logging the original input defeats ARAN.
- Long session TTLs increase the window during which mappings exist in memory.
- Custom detectors and loggers run with full access to the text they receive.

## Recommendations

1. Prefer fail-closed policies (`strict`, `healthcare`, `financial`, `enterprise`) for regulated data.
2. Use `purpose` and purpose rules to minimise what reaches the model.
3. Use `retention: "zero"` for single-turn workloads.
4. Use `encrypted-memory`, or a custom store with an `encryptionKey` from a KMS, if mappings must leave process memory.
5. Add domain-specific detectors (`entities.register`) for your own identifiers.
6. Monitor `warnings` and audit events (`REQUEST_UNCERTAIN`, `OUTPUT_ENTITY_DETECTED`).
