/**
 * Demo 5 — Word (.docx): sanitized text and a sanitized .docx that keeps its layout
 * Run: node demos/05-docx.ts [your.docx]
 */
import { strFromU8, unzipSync } from "fflate";
import { Aran } from "aiaran";
import {
  inputFile,
  makeSampleDocx,
  printEntities,
  printWarnings,
  save,
  step,
  title,
} from "./_shared.ts";

title("DEMO 5 — Protecting Word documents");

const aran = new Aran({ policy: "healthcare" });
const input = await inputFile(() => makeSampleDocx(), "sample-letter.docx");

step("1. Content mode: sanitized text only (good for sending to an AI)");
const content = await aran.protect({ type: "docx", data: input.data });
console.log("status:", content.status);
console.log(content.safeData?.text);

step("2. Document mode: sanitized .docx (headings, tables, formatting kept)");
const result = await aran.protect({
  type: "docx",
  data: input.data,
  mode: "document",
  filename: "letter.docx",
});
console.log("status:", result.status);
printEntities(result.detectedEntities, result.actions);
printWarnings(result.warnings);
if (result.safeData?.document)
  console.log("\nsanitized DOCX:", save("letter.sanitized.docx", result.safeData.document));

step("3. Look inside the sanitized file (hidden places are cleaned too)");
if (result.safeData?.document) {
  const parts = unzipSync(new Uint8Array(result.safeData.document));
  const xml = (name: string): string => strFromU8(parts[name] ?? new Uint8Array());
  console.log(
    "hyperlink target :",
    /Target="(mailto:[^"]*)"/.exec(xml("word/_rels/document.xml.rels"))?.[1],
  );
  console.log("tracked deletion :", /<w:delText[^>]*>([^<]*)</.exec(xml("word/document.xml"))?.[1]);
  console.log("revision author  :", /w:author="([^"]*)"/.exec(xml("word/document.xml"))?.[1]);
  console.log("header           :", /<w:t[^>]*>([^<]*)</.exec(xml("word/header1.xml"))?.[1]);
  console.log(
    "doc creator      :",
    JSON.stringify(/<dc:creator>([^<]*)</.exec(xml("docProps/core.xml"))?.[1]),
  );
  const all = Object.values(parts)
    .map((p) => strFromU8(p))
    .join("");
  console.log("'Ravi' anywhere in the file?", all.includes("Ravi") ? "YES (leak!)" : "no");
}

await aran.dispose();
