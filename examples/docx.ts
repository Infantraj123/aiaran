import { readFile, writeFile } from "node:fs/promises";
import { Aran } from "aiaran";

const aran = new Aran({ policy: "healthcare" });
const result = await aran.protect({
  type: "docx",
  data: await readFile("test-fixtures/sample-letter.docx"),
  mode: "document",
});

console.log(result.status, result.summary.counts);
console.log(result.safeData?.text);
if (result.safeData?.document) await writeFile("letter.sanitized.docx", result.safeData.document);
await aran.dispose();
