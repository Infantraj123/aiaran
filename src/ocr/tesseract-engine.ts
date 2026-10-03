import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { DependencyMissingError, OCRFailureError } from "../core/errors.js";
import { optionalImport } from "../core/optional.js";
import type { OcrEngine, OcrOptions, OcrResult, OcrWord } from "./ocr-engine.js";

export interface TesseractEngineOptions {
  /** Tesseract language codes (default ["eng"]). Use e.g. ["eng", "hin", "tam"] for multilingual OCR. */
  languages?: string[];
  /**
   * Directory containing `<lang>.traineddata(.gz)` files. When omitted ARAN
   * looks for locally installed `@tesseract.js-data/<lang>` packages.
   */
  langPath?: string;
  /** Directory where tesseract.js caches language data. */
  cachePath?: string;
  /**
   * Allow tesseract.js to download language models from its CDN when no
   * local model is found. Only model files are downloaded — images are never
   * uploaded. Default: false (local-only).
   */
  allowModelDownload?: boolean;
  /** Number of worker threads (default 1). */
  workers?: number;
}

interface TesseractBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TesseractWord {
  text: string;
  confidence: number;
  bbox: TesseractBBox;
}
interface TesseractLine {
  words: TesseractWord[];
}
interface TesseractPage {
  blocks: { paragraphs: { lines: TesseractLine[] }[] }[] | null;
}
interface TesseractWorker {
  recognize(
    image: Buffer,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data: TesseractPage }>;
  terminate(): Promise<unknown>;
}
interface TesseractScheduler {
  addWorker(worker: TesseractWorker): void;
  addJob(
    action: "recognize",
    image: Buffer,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data: TesseractPage }>;
  terminate(): Promise<unknown>;
}
interface TesseractModule {
  createWorker(
    langs: string | string[],
    oem?: number,
    options?: Record<string, unknown>,
  ): Promise<TesseractWorker>;
  createScheduler(): TesseractScheduler;
  OEM: { LSTM_ONLY: number };
}

/** Local OCR using tesseract.js (optional peer dependency). */
export class TesseractEngine implements OcrEngine {
  readonly name = "tesseract.js";
  readonly version = "local";
  private scheduler: Promise<TesseractScheduler> | undefined;
  private readonly languages: string[];

  constructor(private readonly options: TesseractEngineOptions = {}) {
    this.languages = options.languages ?? ["eng"];
  }

  /** Throws a descriptive error if the engine cannot run locally. */
  async ensureAvailable(): Promise<void> {
    await this.getScheduler();
  }

  async extract(image: Buffer, _options?: OcrOptions): Promise<OcrResult> {
    const scheduler = await this.getScheduler();
    let page: TesseractPage;
    try {
      const result = await scheduler.addJob("recognize", image, {}, { blocks: true, text: false });
      page = result.data;
    } catch (error) {
      throw new OCRFailureError("OCR engine failed to process the image.", { cause: error });
    }
    const words: OcrWord[] = [];
    let line = 0;
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const l of paragraph.lines) {
          for (const w of l.words) {
            const text = w.text.trim();
            if (!text) continue;
            words.push({
              text,
              confidence: w.confidence,
              bbox: {
                x: w.bbox.x0,
                y: w.bbox.y0,
                width: w.bbox.x1 - w.bbox.x0,
                height: w.bbox.y1 - w.bbox.y0,
              },
              line,
            });
          }
          line++;
        }
      }
    }
    const confidence = words.length
      ? words.reduce((s, w) => s + w.confidence, 0) / words.length
      : 100;
    return { words, confidence };
  }

  async dispose(): Promise<void> {
    const scheduler = this.scheduler;
    this.scheduler = undefined;
    if (scheduler) await (await scheduler.catch(() => undefined))?.terminate();
  }

  private getScheduler(): Promise<TesseractScheduler> {
    this.scheduler ??= this.createScheduler().catch((error: unknown) => {
      this.scheduler = undefined;
      throw error;
    });
    return this.scheduler;
  }

  private async createScheduler(): Promise<TesseractScheduler> {
    const tesseract = await optionalImport<TesseractModule>("tesseract.js", "OCR");
    const langPath = this.options.langPath ?? resolveLocalLangPath(this.languages);
    if (!langPath && !this.options.allowModelDownload) {
      throw new DependencyMissingError(
        `@tesseract.js-data/${this.languages[0] ?? "eng"}`,
        "offline OCR language data (or pass ocr.langPath, or set ocr.allowModelDownload)",
      );
    }
    const workerOptions: Record<string, unknown> = {
      ...(langPath ? { langPath, gzip: hasGzipData(langPath, this.languages) } : {}),
      ...(this.options.cachePath ? { cachePath: this.options.cachePath } : {}),
      ...(langPath ? { cacheMethod: "none" } : {}),
    };
    const scheduler = tesseract.createScheduler();
    const count = Math.max(1, Math.min(8, this.options.workers ?? 1));
    try {
      for (let i = 0; i < count; i++) {
        const worker = await tesseract.createWorker(
          this.languages,
          tesseract.OEM.LSTM_ONLY,
          workerOptions,
        );
        scheduler.addWorker(worker);
      }
    } catch (error) {
      await scheduler.terminate().catch(() => undefined);
      throw new OCRFailureError("Failed to initialise the local OCR engine.", { cause: error });
    }
    return scheduler;
  }
}

/** Find language data shipped as `@tesseract.js-data/<lang>` npm packages (single directory only). */
function resolveLocalLangPath(languages: string[]): string | undefined {
  const require = createRequire(import.meta.url);
  const dirs = new Set<string>();
  for (const lang of languages) {
    let pkgDir: string;
    try {
      pkgDir = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    } catch {
      return undefined;
    }
    const candidate = ["4.0.0_best_int", "4.0.0"]
      .map((v) => join(pkgDir, v))
      .find(
        (d) =>
          existsSync(join(d, `${lang}.traineddata.gz`)) ||
          existsSync(join(d, `${lang}.traineddata`)),
      );
    if (!candidate) return undefined;
    dirs.add(candidate);
  }
  // tesseract.js accepts one langPath; multiple packages need an explicit shared langPath.
  return dirs.size === 1 ? [...dirs][0] : undefined;
}

function hasGzipData(dir: string, languages: string[]): boolean {
  return languages.every((l) => existsSync(join(dir, `${l}.traineddata.gz`)));
}
