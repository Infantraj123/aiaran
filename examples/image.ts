import { readFile, writeFile } from "node:fs/promises";
import { Aran } from "aiaran";

// Requires: npm install sharp tesseract.js @tesseract.js-data/eng
const aran = new Aran({ policy: "healthcare" });

const result = await aran.protect({
  type: "image",
  data: await readFile("test-fixtures/sample-screenshot.png"),
  filename: "sample-screenshot.png",
});

console.log(result.status, result.summary);
for (const w of result.warnings) console.log(`[${w.code}] ${w.message}`);

if (result.safeData) {
  await writeFile("screenshot.redacted.png", result.safeData.image);
  console.log(result.safeData.text);
}
await aran.dispose();
