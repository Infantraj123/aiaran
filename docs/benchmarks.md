# Benchmarks

Run with:

```bash
npm run build
npm run bench                      # all cases
node scripts/benchmark.mjs text-1mb pdf-100-pages   # selected cases
```

All inputs are synthetic and generated in memory. Text inputs are deliberately dense: a sensitive value every ~25 characters, far denser than real documents. That makes them a worst case for the tokenization path.

Reference run: Intel Core i5-1235U (12 threads), Node.js 24.14, Linux, default `Aran` options except relaxed limits.

| Case            | Input                                | Time   | Entities | Heap   | Notes                                                            |
| --------------- | ------------------------------------ | ------ | -------- | ------ | ---------------------------------------------------------------- |
| `text-1kb`      | 1 KB                                 | 22 ms  | 39       | 16 MB  | First call includes JIT warm-up                                  |
| `text-100kb`    | 100 KB                               | 45 ms  | 3,901    | 20 MB  |                                                                  |
| `text-1mb`      | 1 MB                                 | 371 ms | 39,946   | 76 MB  |                                                                  |
| `pdf-100-pages` | 100-page text PDF                    | 459 ms | 12,000   | 66 MB  | Text layer only, no images, so no OCR                            |
| `pdf-10mb`      | 10 MB, ~88 pages, one image per page | 55 s   | 2,640    | 43 MB  | Every page has an image, so `auto` OCRs every page (~0.6 s/page) |
| `image-1080p`   | 1920×1080 screenshot                 | 901 ms | 24       | 34 MB  | Local OCR (warm worker)                                          |
| `docx-large`    | 5,000 paragraphs, document mode      | 221 ms | 20,000   | 118 MB |                                                                  |

## Tuning

- **OCR dominates** image and scanned-document cost. If you know your PDFs are digital (no text inside images), set `pdf: { ocr: "never" }`; pages without a text layer are then reported as not inspected rather than OCR'd.
- `ocr: { workers: N }` starts more Tesseract worker threads, and `concurrency` bounds concurrent OCR jobs per `Aran` instance. Use them when you protect several images or documents in parallel.
- `pdf.renderScale` (default 2, about 144 DPI) trades OCR accuracy against time and memory.
- Reuse one `Aran` instance. OCR workers are initialised once and reused.
- `limits.timeoutMs` (default 120 s) bounds each request. Large scanned documents may need a higher value.
