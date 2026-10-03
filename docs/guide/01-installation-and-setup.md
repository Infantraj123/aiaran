# 1. Installation and setup

This chapter gets ARAN installed with exactly the features you need and shows how to confirm that each feature works.

- [1.1 Requirements](#11-requirements)
- [1.2 Install the core package](#12-install-the-core-package)
- [1.3 Add features (images, OCR, PDF, AI providers)](#13-add-features)
- [1.4 Check your setup with `aran doctor`](#14-check-your-setup-with-aran-doctor)
- [1.5 OCR languages (English, Hindi, Tamil, …)](#15-ocr-languages)
- [1.6 Using ARAN from TypeScript, ESM and CommonJS](#16-typescript-esm-and-commonjs)
- [1.7 A new project from scratch](#17-a-new-project-from-scratch)
- [1.8 Offline and air-gapped machines](#18-offline-and-air-gapped-machines)
- [1.9 Docker](#19-docker)
- [1.10 Fonts (Linux servers)](#110-fonts-linux-servers)

---

## 1.1 Requirements

| Requirement       | Version                                                | Notes                                                                  |
| ----------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Node.js           | **20.19 or later** (22 LTS recommended)                | Check with `node -v`. PDF support works best on Node 22.13+ (see 1.3). |
| npm / pnpm / yarn | any recent                                             | Examples use npm.                                                      |
| OS                | Linux, macOS, Windows                                  | `sharp` and the PDF canvas ship prebuilt binaries for all three.       |
| RAM               | 512 MB+ for text; 1–2 GB if you OCR large scanned PDFs |                                                                        |

ARAN never needs an ARAN account, API key or cloud service. Everything runs inside your Node.js process.

## 1.2 Install the core package

```bash
npm install aiaran
```

That's all you need for **text, JSON and Word (.docx) text**. The core has only two small dependencies (`yaml` and `fflate`).

> The npm package is called **`aiaran`**. In code you import `Aran` from `"aiaran"`, and the command-line tool is called `aran`.

Try it immediately:

```ts
// hello.mjs
import { Aran } from "aiaran";

const aran = new Aran();
const result = await aran.protect({
  type: "text",
  data: "My name is John and my email is john@example.com",
});
console.log(result.safeData);
// My name is [PERSON_001] and my email is [EMAIL_001]
```

```bash
node hello.mjs
```

## 1.3 Add features

Heavier features are **optional**. Install only what you use:

| You want to protect…                              | Install                                          | Why                                          |
| ------------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| Text, JSON                                        | nothing extra                                    | built in                                     |
| Word `.docx`                                      | nothing extra                                    | built in                                     |
| Images inside `.docx` files                       | `sharp tesseract.js @tesseract.js-data/eng`      | to read and redact the images                |
| Images (PNG, JPEG, WebP, TIFF)                    | `sharp tesseract.js @tesseract.js-data/eng`      | decode/redact + local OCR + English OCR data |
| PDFs, content mode                                | `pdfjs-dist`                                     | text extraction, page rendering              |
| Scanned PDFs                                      | `pdfjs-dist tesseract.js @tesseract.js-data/eng` | pages are rendered and OCR'd                 |
| PDFs, document mode (sanitized PDF file)          | `pdfjs-dist pdf-lib`                             | `pdf-lib` writes the new PDF                 |
| Anthropic (Claude) models                         | `@anthropic-ai/sdk`                              | official SDK                                 |
| OpenAI, Gemini, Ollama, OpenAI-compatible servers | nothing extra                                    | uses built-in `fetch`                        |

**Everything at once:**

```bash
npm install aiaran sharp tesseract.js @tesseract.js-data/eng pdfjs-dist pdf-lib
```

### Which pdfjs-dist version?

| Your Node.js   | Install                                    | Notes                                                                                                                                                                                                                |
| -------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22.13 or later | `npm install pdfjs-dist@latest` (6.2.108+) | Recommended.                                                                                                                                                                                                         |
| 20.x           | `npm install pdfjs-dist@5.6.205`           | pdfjs-dist 6 needs Node 22.13+. `npm audit` reports advisory GHSA-hq66-cqwq-w95j for 5.6.x. It affects the browser PDF _viewer_ with scripting enabled, which ARAN never uses. See [SECURITY.md](../../SECURITY.md). |

If a feature's package is missing, ARAN tells you exactly what to install instead of silently skipping the feature:

```text
DependencyMissingError: Optional dependency "sharp" is required for image processing. Install it with: npm install sharp
```

## 1.4 Check your setup with `aran doctor`

After installing, run:

```bash
npx aran doctor
```

Example output on a machine with everything installed:

```text
ARAN 0.1.0 — environment check

✓ Node.js                                      v24.14.1
✓ Text protection                              built in
✓ Images (sharp)                               sharp 0.35.5
✓ OCR (tesseract.js)                           tesseract.js 7.0.0, languages: eng (local data)
✓ PDF (pdfjs-dist)                             pdfjs-dist 6.3.289
✓ PDF rendering (scanned PDFs, document mode)  page rendering works
✓ PDF document mode (pdf-lib)                  pdf-lib 1.17.1
✓ DOCX                                         built in (embedded images need sharp + OCR)
✓ Anthropic provider                           @anthropic-ai/sdk 0.131.0
✓ OpenAI / Gemini / Ollama providers           built in (fetch)
```

A missing feature shows `✗` and the command that fixes it:

```text
✗ Images (sharp)                               needed for image input and DOCX embedded images
                                               → npm install sharp
```

`aran doctor` really runs a text protection, starts the OCR engine and renders a small PDF, so a `✓` means the feature works, not just that the package is installed. Use `--ocr-lang eng,hin,tam --ocr-path ./tessdata` to check other OCR languages (see 1.5), and `--json` for scripts.

## 1.5 OCR languages

OCR, the step that reads text from images and scanned PDFs, runs **locally** with Tesseract. ARAN does not download language models by default. You install them as npm packages.

### English only (default)

```bash
npm install tesseract.js @tesseract.js-data/eng
```

No configuration needed. ARAN finds `@tesseract.js-data/eng` automatically.

### One other language

```bash
npm install @tesseract.js-data/hin      # Hindi
```

```ts
const aran = new Aran({ ocr: { languages: ["hin"] } });
```

### Several languages at once (e.g. English + Hindi + Tamil)

Tesseract loads all languages from **one folder**, so put the model files together:

```bash
npm install @tesseract.js-data/eng @tesseract.js-data/hin @tesseract.js-data/tam
mkdir -p tessdata
cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz tessdata/
cp node_modules/@tesseract.js-data/hin/4.0.0_best_int/hin.traineddata.gz tessdata/
cp node_modules/@tesseract.js-data/tam/4.0.0_best_int/tam.traineddata.gz tessdata/
```

```ts
const aran = new Aran({
  ocr: {
    languages: ["eng", "hin", "tam"],
    langPath: "./tessdata",
  },
});
```

Check it:

```bash
npx aran doctor --ocr-lang eng,hin,tam --ocr-path ./tessdata
# ✓ OCR (tesseract.js)   tesseract.js 7.0.0, languages: eng+hin+tam (from --ocr-path)
```

The same two flags work with `aran scan` and `aran protect`.

Result on a mixed English/Hindi screenshot with `languages: ["eng", "hin"]`:

```text
Patient name: [PERSON_001]
मरीज़ का नाम: [PERSON_002]
फ़ोन [PHONE_REDACTED]
```

### Allowing model downloads (optional)

If you prefer tesseract.js to download models from its CDN:

```ts
new Aran({
  ocr: { languages: ["eng", "hin"], allowModelDownload: true, cachePath: "./.ocr-cache" },
});
```

Only model files are downloaded. Your images are never uploaded anywhere.

### All OCR options

```ts
new Aran({
  ocr: {
    languages: ["eng"], // Tesseract language codes
    langPath: "./tessdata", // folder with <lang>.traineddata(.gz)
    cachePath: "./.ocr-cache", // where tesseract.js caches models
    allowModelDownload: false, // default: local only
    workers: 2, // OCR worker threads (default 1)
  },
  concurrency: 2, // max OCR jobs at the same time (default 2)
});

new Aran({ ocr: false }); // disable OCR completely (images/scanned pages become "uncertain")
```

You can also plug in your own OCR engine. Any object with `extract(image)` works; see [chapter 4](04-images.md#46-using-a-different-ocr-engine).

## 1.6 TypeScript, ESM and CommonJS

ARAN ships ES modules, CommonJS and TypeScript types.

```ts
// ESM / TypeScript
import { Aran, type ProtectionResult } from "aiaran";
```

```js
// CommonJS
const { Aran } = require("aiaran");
```

Recommended `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true
  }
}
```

Top-level `await` (used in this guide's examples) needs ES modules: `"type": "module"` in `package.json`, or `.mjs` / `.mts` files. In CommonJS, wrap calls in an `async function main() { … }`.

## 1.7 A new project from scratch

```bash
mkdir my-safe-ai && cd my-safe-ai
npm init -y
npm pkg set type=module
npm install aiaran sharp tesseract.js @tesseract.js-data/eng pdfjs-dist pdf-lib
npx aran doctor
```

Create `index.js`:

```js
import { readFile } from "node:fs/promises";
import { Aran } from "aiaran";

const aran = new Aran({ policy: "default" });

// 1. text
const t = await aran.protect({ type: "text", data: "Call Ravi Kumar on +91 98765 43210" });
console.log("text :", t.safeData);

// 2. a file chosen by extension
const file = process.argv[2];
if (file) {
  const data = await readFile(file);
  const type = file.endsWith(".pdf") ? "pdf" : file.endsWith(".docx") ? "docx" : "image";
  const r = await aran.protect({ type, data, filename: file });
  console.log(type, ":", r.status, r.summary);
}

await aran.dispose(); // stops OCR workers so the process can exit
```

```bash
node index.js
node index.js ./scan.png
```

> **Always call `aran.dispose()`** when your script ends. OCR runs in worker threads, and `dispose()` stops them. Long-running servers keep one `Aran` instance for their whole lifetime and call `dispose()` on shutdown.

## 1.8 Offline and air-gapped machines

ARAN works with no network at all:

1. On a connected machine: `npm install` (including `@tesseract.js-data/*` for each language you need).
2. Copy the project, including `node_modules`, to the offline machine, or build a Docker image (1.9).
3. Run `npx aran doctor`. Every check runs locally.

The only network calls ARAN can make are the AI provider requests that **you** start (`generate()` or a provider adapter). Use `OllamaProvider` for a fully local setup.

## 1.9 Docker

The repository includes [`examples/docker/Dockerfile`](../../examples/docker/Dockerfile), which builds the CLI with images, OCR (English) and PDF support:

```bash
docker build -f examples/docker/Dockerfile -t aran .
docker run --rm --network none aran doctor
docker run --rm --network none -v "$PWD:/data" aran scan /data/report.pdf
docker run --rm --network none -v "$PWD:/data" aran protect /data/letter.docx --mode document --out /data/letter.safe.docx
```

`--network none` proves nothing leaves the container. For your own service image, base it on `node:22-bookworm-slim`, install `fonts-dejavu-core` (see 1.10) and install `aiaran` plus the optional packages in your `package.json`.

## 1.10 Fonts (Linux servers)

Redacted images and PDFs get a small label such as `[PERSON_001]` drawn inside each black box. On minimal Linux images without fonts the boxes are still drawn and redaction still works, but the labels may be missing. Install a font to get them:

```bash
# Debian / Ubuntu
apt-get install -y fonts-dejavu-core
# Alpine
apk add font-dejavu
```

---

Next: [2. Core concepts →](02-core-concepts.md)
