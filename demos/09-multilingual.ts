/**
 * Demo 9 — English, Hindi and Tamil text
 * Run: node demos/09-multilingual.ts
 */
import { Aran, guessLanguage } from "aiaran";
import { printEntities, step, title } from "./_shared.ts";

title("DEMO 9 — Multilingual text");

const aran = new Aran({ policy: "healthcare" });
const samples = [
  "Patient name: Ravi Kumar, phone 98765 43210.",
  "मरीज़ का नाम: राहुल शर्मा, फ़ोन 98765 12345, आधार 2345 6789 0124.",
  "நோயாளி பெயர்: மீனா சுந்தரம், தொலைபேசி 91234 56789.",
  "Name: राहुल शर्मा, email rahul.sharma@example.com, आयु 45",
];
for (const text of samples) {
  step(`language guess: ${guessLanguage(text)}`);
  const r = await aran.protect({ type: "text", data: text });
  console.log("in :", text);
  console.log("out:", r.safeData);
  printEntities(r.detectedEntities, r.actions);
}
await aran.dispose();
