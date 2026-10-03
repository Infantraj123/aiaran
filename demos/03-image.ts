/**
 * Demo 3 — Images: OCR → detect → paint over → redacted PNG
 * Needs: npm install sharp tesseract.js @tesseract.js-data/eng
 * Run:   node demos/03-image.ts [your-image.png|jpg|webp|tiff]
 */
import { Aran } from "aiaran";
import {
  inputFile,
  makeSampleImage,
  printEntities,
  printWarnings,
  save,
  step,
  title,
} from "./_shared.ts";

title("DEMO 3 — Protecting an image (screenshot / scanned page / photo of a document)");

const aran = new Aran({ policy: "healthcare" });
const input = await inputFile(() => makeSampleImage(), "sample-image.png");

step("1. aran.protect({ type: 'image' })");
const started = Date.now();
const result = await aran.protect({ type: "image", data: input.data });
console.log(
  `status: ${result.status}   (${Date.now() - started} ms, includes starting the OCR worker)`,
);
printEntities(result.detectedEntities, result.actions);
printWarnings(result.warnings);

step("2. Bounding boxes (where each value was painted over)");
for (const e of result.detectedEntities) {
  const b = e.boundingBox;
  if (b)
    console.log(
      `${e.type.padEnd(12)} x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.width)} h=${Math.round(b.height)}`,
    );
}

if (result.safeData) {
  step("3. Outputs");
  console.log("redacted image :", save("image.redacted.png", result.safeData.image));
  console.log("sanitized text :\n" + result.safeData.text);
} else {
  console.log("\nNo safe image returned — check status and warnings above.");
}

step("4. Second OCR pass over the redacted image (verification)");
if (result.safeData) {
  const check = await aran.scan({ type: "image", data: result.safeData.image });
  console.log(
    "entities still readable:",
    check.detectedEntities.map((e) => e.type).filter((t) => t !== "AGE"),
  );
}

await aran.dispose(); // stops the OCR worker threads
