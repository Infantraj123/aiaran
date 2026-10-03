# 11. Troubleshooting and FAQ

- [11.1 First step: `aran doctor`](#111-first-step-aran-doctor)
- [11.2 Every warning code](#112-every-warning-code)
- [11.3 Every error](#113-every-error)
- [11.4 Common problems](#114-common-problems)
- [11.5 FAQ](#115-faq)

---

## 11.1 First step: `aran doctor`

```bash
npx aran doctor
```

It checks Node.js, every optional package, OCR language data and PDF rendering, and prints the fix for anything missing ([chapter 1.4](01-installation-and-setup.md#14-check-your-setup-with-aran-doctor)).

## 11.2 Every warning code

Warnings appear in `result.warnings`. A warning marked **incomplete** makes `status` `"uncertain"`, and under a fail-closed policy `safeData` becomes `null`.

| Code                             | Severity        | Incomplete?                  | Meaning                                                                                         | What to do                                                                                                    |
| -------------------------------- | --------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OCR_UNAVAILABLE`                | error           | yes                          | OCR isn't installed, its language data is missing, or `ocr: false`                              | `npm install tesseract.js @tesseract.js-data/eng`, run `aran doctor`                                          |
| `OCR_FAILED`                     | error           | yes                          | OCR crashed or timed out on an image or page                                                    | raise `limits.ocrTimeoutMs`; check the image isn't corrupt                                                    |
| `OCR_LOW_CONFIDENCE`             | warning / error | below 40 % only              | blurry, small or unusual text                                                                   | use a better source image, upscale, install the right language                                                |
| `FACES_NOT_INSPECTED`            | info            | no                           | no face detector is configured                                                                  | configure `faceDetector` if faces matter ([4.5](04-images.md#45-faces))                                       |
| `PDF_SCANNED_PAGE`               | error           | yes                          | a page has no text layer and was not OCR'd                                                      | install OCR; don't use `pdf.ocr: "never"` for scanned files                                                   |
| `PDF_PAGE_FAILED`                | error           | yes                          | a damaged page couldn't be parsed or rendered                                                   | re-export or repair the PDF                                                                                   |
| `PDF_RENDER_UNAVAILABLE`         | error           | yes                          | pdfjs-dist couldn't load its canvas                                                             | `npm install pdfjs-dist --include=optional`; check the platform is supported                                  |
| `PDF_DOCUMENT_MODE_FAILED`       | error           | yes                          | not every page could be rendered, so no sanitized PDF is returned                               | see the page warnings                                                                                         |
| `PDF_VERIFICATION_FAILED`        | error / warning | if a value is still readable | re-OCR of the sanitized page found a sensitive value                                            | raise `pdf.renderScale`; report it with a synthetic sample                                                    |
| `PDF_ENCRYPTED`                  | –               | –                            | reserved; password-protected PDFs currently raise `UnsupportedFormatError`                      | decrypt first                                                                                                 |
| `DOCUMENT_STRUCTURE_UNSUPPORTED` | warning / error | usually                      | multi-frame image (only the first frame inspected), or DOCX text in CDATA or nested markup      | flatten the image or re-save the document in Word                                                             |
| `EMBEDDED_MEDIA_NOT_INSPECTED`   | error           | yes                          | DOCX embedded objects, EMF/WMF images, altChunks, or images without OCR; PDF images without OCR | install OCR + sharp, or remove the objects                                                                    |
| `METADATA_REMOVED`               | info            | no                           | document properties and author names were cleared                                               | nothing; informational                                                                                        |
| `DETECTOR_FAILED`                | error           | yes                          | a detector (often a custom one) threw an error                                                  | fix the custom detector                                                                                       |
| `ENTITY_LIMIT_REACHED`           | error           | yes                          | more than `limits.maxEntities` entities                                                         | raise the limit or split the input                                                                            |
| `TOKEN_COLLISION_AVOIDED`        | info            | no                           | the input already contained token-like text such as `[PERSON_001]`                              | nothing; ARAN numbered its tokens differently                                                                 |
| `LOW_CONFIDENCE_ENTITY`          | info            | no                           | some weak candidates were below the policy threshold and left unchanged                         | lower `minConfidence` or use `mode: "strict"` if you want them protected                                      |
| `PURPOSE_NOT_MATCHED`            | info            | no                           | a `purpose` was given but no purpose rule matched                                               | add keywords to your policy's purposes ([7.8](07-policies-and-minimization.md#78-purpose-based-minimization)) |
| `FAIL_CLOSED_WITHHELD`           | error           | –                            | fail-closed: `safeData` was withheld because of the warnings above                              | fix the cause, or use `failMode: "open"` and handle `uncertain` yourself                                      |
| `NO_SESSION`                     | warning         | –                            | `release()` without a valid session: unknown, expired, destroyed, or on another server instance | pass the right `sessionId`; see [10.5](10-production-and-security.md#105-running-several-server-instances)    |
| `UNKNOWN_TOKEN`                  | warning         | –                            | the answer contains `[X_001]`-style tokens that aren't in this session                          | normal if the user typed them; otherwise check the session ID                                                 |
| `TOKEN_NOT_RESTORABLE`           | info            | –                            | tokens left in place because the policy says `restore: false`                                   | intended                                                                                                      |
| `OUTPUT_SENSITIVE_DATA`          | warning / error | –                            | the AI answer contained sensitive values ARAN did not put there                                 | handled per the output policy ([7.7](07-policies-and-minimization.md#77-output-rules))                        |

## 11.3 Every error

All errors extend `AranError` and have a stable `code`. Messages never contain your data.

| Class                                 | `code`                      | Typical cause                                                                                                                                           | Fix                                                               |
| ------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `InputValidationError`                | `INPUT_VALIDATION_ERROR`    | wrong `type`, missing `data`, unknown or expired `sessionId`, Date or Buffer inside a JSON object, file extension or MIME type not matching the content | correct the input                                                 |
| `UnsupportedFormatError`              | `UNSUPPORTED_FORMAT`        | not the declared type, legacy `.doc`, `.docm`, password-protected PDF, GIF/SVG/HEIC image                                                               | convert the file                                                  |
| `DocumentProcessingError`             | `DOCUMENT_PROCESSING_ERROR` | corrupt PDF, image or zip; DTD in a DOCX                                                                                                                | re-export the file                                                |
| `SecurityError`                       | `SECURITY_ERROR`            | a size, page, pixel, zip or depth limit; fail-closed in `generate()`; tampered encrypted mapping                                                        | see [10.8](10-production-and-security.md#108-limits-and-timeouts) |
| `TimeoutError`                        | `TIMEOUT`                   | processing took longer than `limits.timeoutMs`                                                                                                          | raise the limit; reduce the input                                 |
| `DependencyMissingError`              | `DEPENDENCY_MISSING`        | optional package not installed (`error.dependency`)                                                                                                     | `npm install <dependency>`                                        |
| `PolicyError`                         | `POLICY_ERROR`              | invalid policy or unknown policy name; bad custom entity name or pattern                                                                                | `aran policy validate`                                            |
| `BlockedError`                        | `BLOCKED`                   | `generate()` input blocked; `restore()` output blocked                                                                                                  | expected; tell the user                                           |
| `RestorationError`                    | `RESTORATION_ERROR`         | `restore()` with an unknown or expired session                                                                                                          | use `release()` to get text plus warnings instead                 |
| `ProviderError`                       | `PROVIDER_ERROR`            | AI API error (`error.status`) or network failure                                                                                                        | retry on 429 and 5xx; check the key and model                     |
| `OCRFailureError`                     | `OCR_FAILURE`               | OCR engine failed to start or run (usually reported as a warning instead)                                                                               | `aran doctor`                                                     |
| `TokenizationError`, `DetectionError` | …                           | internal or custom detector problems                                                                                                                    | report with a synthetic sample                                    |

```ts
import { AranError } from "aiaran";

try {
  await aran.protect(input);
} catch (e) {
  if (e instanceof AranError) {
    console.error(e.code, e.message, e.details); // safe to log
  }
}
```

## 11.4 Common problems

**"My script doesn't exit."**
OCR workers are still running. Call `await aran.dispose()` at the end.

**"A name wasn't detected."**
Names are found through cues ("Mr.", "Name:", "Patient …", "my name is …", "Dear …") and a list of common first names. Fixes:

- Use `mode: "strict"` or a lower `minConfidence`.
- Put names in labelled fields (`{ name: "…" }`), where the field name triggers detection.
- Add an ML-based NER detector ([3.10](03-text-and-json.md#310-tuning-detection)).
- Register your own pattern for known name lists ([7.9](07-policies-and-minimization.md#79-your-own-entity-types)).

**"Something was detected that isn't sensitive" (false positive).**

- Raise the type's threshold: `entities: { PHONE: { action: "tokenize", minConfidence: 0.8 } }`.
- Or `allow` that type in your policy.
- Check what was matched: `result.detectedEntities` shows the type and position.

**"The AI changed my tokens and they weren't restored."**
ARAN restores `[PERSON_001]`, `PERSON_001`, `[person_001]` and `[PERSON 001]`. If your model rewrites tokens in other ways (e.g. "Person 1"), keep the placeholder instruction in the system prompt (`generate()` adds it automatically), or use `pseudonymize`, so the model sees natural names.

**"`restore()` throws `RestorationError`."**
The session is unknown here: wrong ID, expired (default 1 hour of inactivity), destroyed (`retention: "zero"` after the first release), or created on another server instance.

**"Images and scanned PDFs are `uncertain`."**
OCR isn't working. Run `npx aran doctor`. For several languages, set `langPath` (or `--ocr-path` in the CLI) ([1.5](01-installation-and-setup.md#15-ocr-languages)).

**"`npm audit` shows a pdfjs-dist advisory."**
You are on pdfjs-dist 5.6.x. On Node 22.13+ run `npm install pdfjs-dist@latest`. On Node 20 this is the only working line; the advisory concerns the browser viewer's scripting, which ARAN doesn't use ([SECURITY.md](../../SECURITY.md)).

**"Redaction boxes have no labels."**
No fonts on the server. `apt-get install fonts-dejavu-core` ([1.10](01-installation-and-setup.md#110-fonts-linux-servers)).

**"Next.js / bundler errors about sharp, canvas or tesseract."**
Don't bundle native packages. Use the Node.js runtime and `serverExternalPackages` ([8.6](08-ai-providers.md#nextjs-route-handler)).

**"Big scanned PDFs are slow or time out."**
OCR takes roughly 0.5–1 s per page. Raise `limits.timeoutMs`, use `ocr: { workers: N }`, lower `pdf.renderScale` to 1.5, or use `pdf.ocr: "never"` for digital PDFs.

**"`InputValidationError: File extension does not match the file content.`"**
The file is not what its name says (for example, a JPEG saved as `.png`). Rename it or leave out `filename`.

## 11.5 FAQ

**Does ARAN send my data anywhere?**
No. Detection, OCR, PDF rendering and redaction run in your process. The only network calls are the provider calls you make yourself. OCR models are loaded from local packages unless you enable `allowModelDownload`.

**Does it work offline?**
Yes, after installation (including OCR language packages). Use `OllamaProvider` for a fully local AI. Docker: `--network none` ([1.8](01-installation-and-setup.md#18-offline-and-air-gapped-machines)).

**Is ARAN HIPAA / GDPR / DPDP compliant?**
ARAN is a technical control that reduces exposure. Compliance depends on your whole system and processes; ARAN alone does not make you compliant.

**Does it catch 100 % of personal data?**
No tool does. Structured identifiers (emails, phones, IDs, cards, keys) are detected reliably with validation. Names and addresses depend on cues. Read the limitations in [docs/threat-model.md](../threat-model.md).

**Tokenize or redact?**
Tokenize data you want back in the answer (names in a letter). Redact data the AI never needs (card numbers, passwords). Use purposes to switch automatically ([7.8](07-policies-and-minimization.md#78-purpose-based-minimization)).

**Can I see the original value of an entity?**
Not through ARAN's results, on purpose. You have the original input, and `detectedEntities[i].start` / `end` point into it.

**Can two users get the same token?**
Yes. Both may get `[PERSON_001]`, but tokens are only restored inside their own session, so one user's token never turns into another user's value.

**Does it support streaming?**
Not in V1. Collect the full answer, then `release()` it ([8.8](08-ai-providers.md#88-streaming)).

**Python? REST API?**
Not in V1. The policy format and design are language-neutral, so these are planned as separate packages.

**How do I report a missed detection?**
Open a "Detection gap" issue with a **synthetic** example in the same format. Never post real data. Security problems go to [SECURITY.md](../../SECURITY.md).

---

← [10. Production and security](10-production-and-security.md) · [Back to the guide index](README.md)
