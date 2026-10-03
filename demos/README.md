# ARAN demos

Runnable, step-by-step demos for every feature. Each one prints what happens at each step and writes its output files to `demos/output/`. All sample data is **synthetic**.

```bash
npm install && npm run build        # once (demos import the built package)
node demos/01-text.ts               # Node 22.18+ runs TypeScript directly
npx tsx demos/01-text.ts            # Node 20
npm run demos                       # run demos 01–09
```

| Demo                                     | Shows                                                               | Guide chapter                                      | Extra packages                              |
| ---------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| [01-text.ts](01-text.ts)                 | protect → AI → release, output scanning, multi-turn, scan           | [3](../docs/guide/03-text-and-json.md)             | –                                           |
| [02-json.ts](02-json.ts)                 | JSON objects, field-name hints, blocking                            | [3](../docs/guide/03-text-and-json.md)             | –                                           |
| [03-image.ts](03-image.ts) `[file]`      | OCR, redacted PNG, bounding boxes, verification                     | [4](../docs/guide/04-images.md)                    | sharp, tesseract.js, @tesseract.js-data/eng |
| [04-pdf.ts](04-pdf.ts) `[file]`          | content mode, document mode, scanned PDF, fail-closed               | [5](../docs/guide/05-pdf.md)                       | pdfjs-dist, pdf-lib, OCR packages           |
| [05-docx.ts](05-docx.ts) `[file]`        | sanitized text and .docx, hidden places                             | [6](../docs/guide/06-word-docx.md)                 | –                                           |
| [06-policies.ts](06-policies.ts)         | built-in policies, shorthand, YAML, purposes, custom entities       | [7](../docs/guide/07-policies-and-minimization.md) | –                                           |
| [07-ai-providers.ts](07-ai-providers.ts) | `generate()` with a mock model or a real provider (`AI_PROVIDER=…`) | [8](../docs/guide/08-ai-providers.md)              | provider-specific                           |
| [08-production.ts](08-production.ts)     | encrypted external store, zero retention, logs, audit, errors       | [10](../docs/guide/10-production-and-security.md)  | –                                           |
| [09-multilingual.ts](09-multilingual.ts) | English, Hindi, Tamil, mixed text                                   | [3](../docs/guide/03-text-and-json.md)             | –                                           |
| [10-web-server.ts](10-web-server.ts)     | ARAN inside an HTTP API (`--self-test` to run requests)             | [8](../docs/guide/08-ai-providers.md)              | –                                           |
| [11-cli.sh](11-cli.sh)                   | every CLI command                                                   | [9](../docs/guide/09-cli.md)                       | –                                           |

Demos 03–05 accept your own file, e.g. `node demos/04-pdf.ts ./my-report.pdf`. Without one, they generate a synthetic sample with [`_shared.ts`](_shared.ts).
