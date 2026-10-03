/**
 * Demo 1 — Text: protect → (AI) → release/restore
 * Run: node demos/01-text.ts
 */
import { Aran } from "aiaran";
import { printEntities, printWarnings, step, title } from "./_shared.ts";

title("DEMO 1 — Protecting plain text");

const aran = new Aran(); // "default" policy

const userInput = `Hi, I'm Ravi Kumar. My email is ravi.kumar@example.com and my phone is +91 98765 43210.
My PAN is ABCPK1234F and I paid with card 4111 1111 1111 1111.
Please summarise my last order.`;

step("1. Original input (stays inside your app)");
console.log(userInput);

step("2. aran.protect()");
const result = await aran.protect({ type: "text", data: userInput });
console.log("status    :", result.status);
console.log("sessionId :", result.sessionId);
console.log("risk      :", result.summary.riskLevel, result.summary.counts);
printEntities(result.detectedEntities, result.actions);
printWarnings(result.warnings);

step("3. safeData — the ONLY thing you send to the AI");
console.log(result.safeData);

step("4. Pretend the AI answered (it only ever saw tokens)");
const aiAnswer =
  "Hello [PERSON_001]! Your order summary was sent to [EMAIL_001]. We will text [PHONE_001] when it ships.";
console.log(aiAnswer);

step("5. aran.release() — scan the answer, then restore tokens");
const released = await aran.release(aiAnswer, result.sessionId);
console.log("status          :", released.status);
console.log("restored tokens :", released.restoredTokens);
console.log("final text      :", released.data);

step("6. The model invents new personal data → output scanning catches it");
const leaky = await aran.release(
  "Also cc'd your colleague at priya.raman@example.org.",
  result.sessionId,
);
console.log(
  "status :",
  leaky.status,
  "| detected:",
  leaky.detectedEntities.map((e) => e.type),
);
console.log("text   :", leaky.data, "(default policy = warn; strict policies redact)");

step("7. Multi-turn chat: reuse the session so tokens stay consistent");
const turn2 = await aran.protect({
  type: "text",
  data: "Ravi Kumar here again, any update?",
  sessionId: result.sessionId,
});
console.log(turn2.safeData, "← same [PERSON_001] as turn 1");

step("8. aran.scan() — detection only, nothing replaced, no session");
const scan = await aran.scan({ type: "text", data: userInput });
console.log("risk:", scan.summary.riskLevel, "| counts:", scan.summary.counts);

step("9. Clean up: destroy the session (deletes all token mappings)");
console.log("destroyed:", await aran.destroySession(result.sessionId));
await aran.dispose();
