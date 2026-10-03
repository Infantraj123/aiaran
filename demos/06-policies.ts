/**
 * Demo 6 — Policies, purpose-based minimization and custom entity types
 * Run: node demos/06-policies.ts
 */
import { Aran, BUILT_IN_POLICY_NAMES, parsePolicyText, resolvePolicy } from "aiaran";
import { step, title } from "./_shared.ts";

title("DEMO 6 — Policies");

const note =
  "Patient John Smith (patient ID P123456), age 52, phone +91 98765 43210, BP 150/95. Portal password: Hunter2025!";

step("1. Same text under every built-in policy");
for (const name of BUILT_IN_POLICY_NAMES) {
  const aran = new Aran({ policy: name });
  const r = await aran.protect({ type: "text", data: note });
  console.log(`\n[${name}] status=${r.status} failMode=${r.metadata.failMode}`);
  console.log(r.safeData ?? "(nothing sent — request blocked)");
  await aran.dispose();
}

step("2. Shorthand policy: { TYPE: action } on top of 'default'");
const shorthand = new Aran({
  policy: { PERSON: "pseudonymize", PHONE: "allow", PASSWORD: "block" },
});
console.log(
  (await shorthand.protect({ type: "text", data: "Call John Smith on +91 98765 43210" })).safeData,
);
await shorthand.dispose();

step("3. YAML policy with a purpose rule");
const yaml = `
name: cardiology-clinic
extends: healthcare
entities:
  PERSON: tokenize
  PASSWORD: redact        # redact instead of block in this clinic
purposes:
  - id: cardiology
    description: Risk scoring needs vitals and age, not identity.
    keywords: [cardio, heart, blood pressure]
    entities:
      PERSON: redact
      PATIENT_ID: redact
      AGE: allow
`;
const clinic = new Aran({ policy: resolvePolicy(parsePolicyText(yaml) as never) });
const withoutPurpose = await clinic.protect({ type: "text", data: note });
console.log("no purpose  :", withoutPurpose.safeData);
const withPurpose = await clinic.protect({
  type: "text",
  data: note,
  purpose: "Estimate cardiovascular risk",
});
console.log("with purpose:", withPurpose.safeData);
console.log("explanation :", withPurpose.minimization);
await clinic.dispose();

step("4. Your own entity type");
const aran = new Aran({ policy: { EMPLOYEE_ID: "tokenize" } });
aran.entities.register({
  name: "EMPLOYEE_ID",
  description: "Internal staff number",
  detector: /\bEMP-\d{5}\b/,
});
aran.entities.register({
  name: "CASE_NUMBER",
  defaultAction: "redact",
  // 6 digits, but only when the word "case" (or Hindi "मामला") is nearby
  detector: {
    pattern: /\b\d{6}\b/,
    context: { keywords: ["case", "मामला"], required: true, windowBefore: 12 },
  },
});
const r = await aran.protect({
  type: "text",
  data: "EMP-00421 opened case 778812; invoice 445566 is unrelated.",
});
console.log(r.safeData);
await aran.dispose();
