// Writes synthetic sample files to test-fixtures/. All data is fictitious.
import { mkdir, writeFile } from "node:fs/promises";
import { makeDocx, makeImage, makeScannedPdf, makeTextPdf, SYNTHETIC as S } from "./fixtures.mjs";

const dir = new URL("../test-fixtures/", import.meta.url);
await mkdir(dir, { recursive: true });

const report = [
  `Patient: ${S.name}`,
  `Patient ID ${S.patientId}, age 52`,
  `Email: ${S.email}  Phone: ${S.phone}`,
  `Aadhaar ${S.aadhaar}  PAN ${S.pan}`,
  "Blood pressure 150/95. Follow-up in 2 weeks.",
];

const text = `Discharge note

Patient Ravi Kumar (patient ID P123456), age 52, was admitted to Lotus Valley Hospital.
Contact: ravi.kumar@example.com, +91 98765 43210. Address: 12 MG Road, Chennai - 600001.
Aadhaar 2345 6789 0124, PAN ABCPK1234F. Insurance policy no HLT-99887766.
मरीज़ का नाम: राहुल शर्मा, फ़ोन 98765 12345.
நோயாளி பெயர்: ராஜேஷ் குமார், தொலைபேசி 91234 56789.
Billing card on file: 4111 1111 1111 1111.
Debug: OPENAI_API_KEY=${S.apiKey} host 10.20.30.40 https://intranet.corp/records/42
`;

await writeFile(new URL("sample-medical.txt", dir), text);
await writeFile(new URL("sample-report.pdf", dir), await makeTextPdf([report]));
await writeFile(new URL("sample-scanned.pdf", dir), await makeScannedPdf(report));
await writeFile(new URL("sample-screenshot.png", dir), await makeImage(report));
await writeFile(
  new URL("sample-letter.docx", dir),
  makeDocx({
    paragraphs: [
      ["Dear ", "Ravi ", "Kumar", ","],
      `Your patient ID is ${S.patientId}.`,
      `We will call you at ${S.phone}.`,
    ],
    table: [
      ["Field", "Value"],
      ["Email", S.email],
      ["PAN", S.pan],
    ],
    header: `Confidential — ${S.name}`,
    hyperlinkEmail: S.email,
  }),
);
await writeFile(
  new URL("sample-policy.yaml", dir),
  `name: clinic
extends: healthcare
description: Example clinic policy
entities:
  PERSON:
    action: tokenize
  EMAIL: redact
  PHONE: redact
  PATIENT_ID:
    action: tokenize
  CREDIT_CARD: block
  PASSWORD: block
output:
  unexpectedEntityAction: redact
purposes:
  - id: cardiology
    keywords: [cardio, heart, blood pressure]
    entities:
      PERSON: redact
      PATIENT_ID: redact
      AGE: allow
`,
);
console.log("Fixtures written to test-fixtures/");
