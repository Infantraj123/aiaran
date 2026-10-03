import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Aran } from "../core/aran.js";
import { TesseractEngine, type TesseractEngineOptions } from "../ocr/tesseract-engine.js";

export interface DoctorCheck {
  feature: string;
  status: "ok" | "missing" | "warning";
  detail: string;
  fix?: string;
}

/** Minimal one-page PDF with a text layer, used to probe PDF support without fixtures. */
const PROBE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 10 50 Td (ARAN doctor probe) Tj ET\nendstream endobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
);

function versionOf(pkg: string): string | undefined {
  const require = createRequire(import.meta.url);
  try {
    return (require(`${pkg}/package.json`) as { version?: string }).version;
  } catch {
    // Packages whose "exports" hide package.json: resolve the entry point and walk up.
    try {
      let dir = dirname(require.resolve(pkg));
      for (let i = 0; i < 6; i++) {
        const file = join(dir, "package.json");
        if (existsSync(file)) {
          const json = JSON.parse(readFileSync(file, "utf8")) as {
            name?: string;
            version?: string;
          };
          if (json.name === pkg) return json.version;
        }
        dir = dirname(dir);
      }
    } catch {
      /* not installed */
    }
    return undefined;
  }
}

function compare(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

async function canImport(specifier: string): Promise<boolean> {
  try {
    await import(specifier);
    return true;
  } catch {
    return false;
  }
}

/** Check which ARAN features are usable in this environment. Never prints user data. */
export async function runDoctor(ocr: TesseractEngineOptions = {}): Promise<DoctorCheck[]> {
  const ocrLanguages = ocr.languages ?? ["eng"];
  const checks: DoctorCheck[] = [];
  const node = process.versions.node;
  checks.push(
    compare(node, "20.19.0") >= 0
      ? { feature: "Node.js", status: "ok", detail: `v${node}` }
      : {
          feature: "Node.js",
          status: "missing",
          detail: `v${node} (need >= 20.19)`,
          fix: "Upgrade Node.js to 20.19 or later (22 LTS recommended).",
        },
  );

  const aran = new Aran({ logger: false, ocr });
  try {
    const text = await aran.protect({ type: "text", data: "Contact probe@example.com" });
    checks.push(
      text.safeData === "Contact [EMAIL_001]"
        ? { feature: "Text protection", status: "ok", detail: "built in" }
        : { feature: "Text protection", status: "warning", detail: "unexpected probe result" },
    );

    const sharp = versionOf("sharp");
    checks.push(
      sharp && (await canImport("sharp"))
        ? { feature: "Images (sharp)", status: "ok", detail: `sharp ${sharp}` }
        : {
            feature: "Images (sharp)",
            status: "missing",
            detail: "needed for image input and DOCX embedded images",
            fix: "npm install sharp",
          },
    );

    const tesseract = versionOf("tesseract.js");
    if (!tesseract) {
      checks.push({
        feature: "OCR (tesseract.js)",
        status: "missing",
        detail: "needed for images and scanned PDFs",
        fix: "npm install tesseract.js @tesseract.js-data/eng",
      });
    } else {
      const engine = new TesseractEngine(ocr);
      try {
        await engine.ensureAvailable();
        checks.push({
          feature: "OCR (tesseract.js)",
          status: "ok",
          detail: `tesseract.js ${tesseract}, languages: ${ocrLanguages.join("+")} (${ocr.langPath ? "from --ocr-path" : "local data"})`,
        });
      } catch {
        checks.push({
          feature: "OCR (tesseract.js)",
          status: "missing",
          detail: `tesseract.js ${tesseract} installed, but language data for ${ocrLanguages.join("+")} was not found locally`,
          fix:
            ocrLanguages.length > 1
              ? "Put all <lang>.traineddata.gz files in one folder and pass --ocr-path <folder> (in code: ocr: { languages, langPath })."
              : `npm install ${ocrLanguages.map((l) => `@tesseract.js-data/${l}`).join(" ")}`,
        });
      } finally {
        await engine.dispose();
      }
    }

    const pdfjs = versionOf("pdfjs-dist");
    if (!pdfjs) {
      checks.push({
        feature: "PDF (pdfjs-dist)",
        status: "missing",
        detail: "needed for PDF input",
        fix: "npm install pdfjs-dist",
      });
    } else {
      const vulnerable = compare(pdfjs, "5.6.83") >= 0 && compare(pdfjs, "6.2.108") < 0;
      checks.push(
        vulnerable
          ? {
              feature: "PDF (pdfjs-dist)",
              status: "warning",
              detail: `pdfjs-dist ${pdfjs}: covered by advisory GHSA-hq66-cqwq-w95j (viewer scripting; not used by ARAN)`,
              fix:
                compare(node, "22.13.0") >= 0
                  ? "npm install pdfjs-dist@latest"
                  : "Node 20 can only use pdfjs-dist 5.6.x; use Node 22.13+ to upgrade.",
            }
          : { feature: "PDF (pdfjs-dist)", status: "ok", detail: `pdfjs-dist ${pdfjs}` },
      );
      const probe = await aran
        .protect({ type: "pdf", data: PROBE_PDF, mode: "document" })
        .catch(() => undefined);
      const codes = probe?.warnings.map((w) => w.code) ?? [];
      checks.push(
        probe &&
          !codes.includes("PDF_RENDER_UNAVAILABLE") &&
          !codes.includes("PDF_DOCUMENT_MODE_FAILED")
          ? {
              feature: "PDF rendering (scanned PDFs, document mode)",
              status: "ok",
              detail: "page rendering works",
            }
          : {
              feature: "PDF rendering (scanned PDFs, document mode)",
              status: "missing",
              detail: "pdfjs-dist could not load its canvas (@napi-rs/canvas)",
              fix: "Reinstall pdfjs-dist with optional dependencies: npm install pdfjs-dist --include=optional",
            },
      );
    }

    const pdfLib = versionOf("pdf-lib");
    checks.push(
      pdfLib
        ? { feature: "PDF document mode (pdf-lib)", status: "ok", detail: `pdf-lib ${pdfLib}` }
        : {
            feature: "PDF document mode (pdf-lib)",
            status: "missing",
            detail: "needed to write sanitized PDFs",
            fix: "npm install pdf-lib",
          },
    );

    checks.push({
      feature: "DOCX",
      status: "ok",
      detail: "built in (embedded images need sharp + OCR)",
    });

    const anthropic = versionOf("@anthropic-ai/sdk");
    checks.push(
      anthropic
        ? { feature: "Anthropic provider", status: "ok", detail: `@anthropic-ai/sdk ${anthropic}` }
        : {
            feature: "Anthropic provider",
            status: "missing",
            detail: "optional",
            fix: "npm install @anthropic-ai/sdk",
          },
    );
    checks.push({
      feature: "OpenAI / Gemini / Ollama providers",
      status: "ok",
      detail: "built in (fetch)",
    });
  } finally {
    await aran.dispose();
  }
  return checks;
}
