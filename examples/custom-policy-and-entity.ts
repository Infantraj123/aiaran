import { Aran, loadPolicyFile, type AuditEvent } from "aiaran";

const events: AuditEvent[] = [];
const aran = new Aran({
  policy: await loadPolicyFile("test-fixtures/sample-policy.yaml"),
  audit: (event) => void events.push(event), // value-free events, e.g. for a SIEM
});

// Organisation-specific identifier with a multilingual context requirement.
aran.entities.register({
  name: "EMPLOYEE_ID",
  description: "Internal employee number",
  defaultAction: "tokenize",
  detector: {
    pattern: /\bEMP-\d{5}\b/,
    context: { keywords: ["employee", "staff", "कर्मचारी", "ஊழியர்"] },
  },
});

const result = await aran.protect({
  type: "text",
  data: "Employee EMP-00421 (Ravi Kumar) reported chest pain; blood pressure 160/100.",
  purpose: "cardiology triage",
});

console.log(result.safeData);
console.log(result.minimization);
console.log(events.map((e) => `${e.event}${e.entityType ? `:${e.entityType}` : ""}`));
await aran.dispose();
