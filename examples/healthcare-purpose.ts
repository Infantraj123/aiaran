import { Aran } from "aiaran";

const aran = new Aran({ policy: "healthcare", mode: "strict" });

const note = `Patient John Smith, patient ID P123456, age 52.
Phone +91 98765 43210. Blood pressure 150/95, LDL 190 mg/dL, on atorvastatin.`;

// Without a purpose: patient identity is tokenized (restorable).
const general = await aran.protect({ type: "text", data: note });
console.log(general.safeData);

// With a clinical purpose: identifiers are removed entirely, clinical context kept.
const clinical = await aran.protect({
  type: "text",
  data: note,
  purpose: "Analyze cardiovascular risk",
});
console.log(clinical.safeData);
console.log(clinical.minimization);
// { purpose: 'Analyze cardiovascular risk', matchedRule: 'clinical-analysis',
//   removed: ['PERSON', 'PATIENT_ID', 'PHONE'], retained: ['AGE'], tokenized: [], blocked: [], reason: '…' }

await aran.dispose();
