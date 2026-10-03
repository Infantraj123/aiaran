# 7. Policies and data minimization

Demo: [`demos/06-policies.ts`](../../demos/06-policies.ts) · Full field reference: [docs/policies.md](../policies.md)

- [7.1 What a policy is](#71-what-a-policy-is)
- [7.2 The built-in policies compared](#72-the-built-in-policies-compared)
- [7.3 Choosing a policy](#73-choosing-a-policy)
- [7.4 Quick custom policy (shorthand)](#74-quick-custom-policy-shorthand)
- [7.5 Full custom policy in code](#75-full-custom-policy-in-code)
- [7.6 YAML / JSON policy files](#76-yaml--json-policy-files)
- [7.7 Output rules](#77-output-rules)
- [7.8 Purpose-based minimization](#78-purpose-based-minimization)
- [7.9 Your own entity types](#79-your-own-entity-types)
- [7.10 Validating policies](#710-validating-policies)

---

## 7.1 What a policy is

A policy answers four questions:

1. **For each entity type, what happens?** `allow`, `redact`, `tokenize`, `pseudonymize` or `block` (see [2.4](02-core-concepts.md#24-actions)).
2. **How sure must ARAN be?** A minimum confidence (`minConfidence`).
3. **What if something can't be inspected?** `failMode: "open"` or `"closed"`.
4. **What about the AI's answer?** Output rules: restore tokens, and what to do with new sensitive data.

Set it once, when you create `Aran`:

```ts
new Aran({ policy: "healthcare" });
```

## 7.2 The built-in policies compared

Demo 6 runs the same note through every built-in policy:

```text
Patient John Smith (patient ID P123456), age 52, phone +91 98765 43210, BP 150/95. Portal password: Hunter2025!
```

```text
[default] status=safe failMode=open
Patient [PERSON_001] (patient ID [PATIENT_ID_001]), age 52, phone [PHONE_001], BP 150/95. Portal password: [PASSWORD_REDACTED]

[strict] status=blocked failMode=closed
(nothing sent — request blocked)

[healthcare] status=blocked failMode=closed
(nothing sent — request blocked)

[financial] status=blocked failMode=closed
(nothing sent — request blocked)

[developer] status=safe failMode=open
Patient [PERSON_001] (patient ID [PATIENT_ID_REDACTED]), age 52, phone [PHONE_001], BP 150/95. Portal password: [PASSWORD_REDACTED]

[enterprise] status=blocked failMode=closed
(nothing sent — request blocked)
```

The password causes the block: `strict`, `healthcare`, `financial` and `enterprise` **block** secrets, while `default` and `developer` **redact** them.

|                                         | default                 | strict     | healthcare                                        | financial                   | developer               | enterprise |
| --------------------------------------- | ----------------------- | ---------- | ------------------------------------------------- | --------------------------- | ----------------------- | ---------- |
| Fail mode                               | open                    | **closed** | **closed**                                        | **closed**                  | open                    | **closed** |
| Min. confidence                         | 0.50                    | 0.35       | 0.45                                              | 0.45                        | 0.50                    | 0.45       |
| PERSON                                  | tokenize                | tokenize   | tokenize                                          | tokenize                    | tokenize                | tokenize   |
| EMAIL, PHONE                            | tokenize                | tokenize   | **redact**                                        | tokenize                    | tokenize                | tokenize   |
| ADDRESS                                 | tokenize                | redact     | redact                                            | redact                      | tokenize                | tokenize   |
| DATE_OF_BIRTH                           | redact                  | redact     | redact                                            | redact                      | redact                  | redact     |
| Gov. IDs (Aadhaar, PAN, SSN, passport…) | tokenize                | redact     | redact                                            | PAN tokenize, others redact | redact                  | redact     |
| CREDIT_CARD                             | redact                  | **block**  | **block**                                         | **block**                   | redact                  | **block**  |
| Bank/IBAN/UPI/transaction               | tokenize                | redact     | redact                                            | tokenize                    | redact/allow            | tokenize   |
| Secrets (passwords, keys, tokens…)      | redact                  | **block**  | **block**                                         | **block**                   | redact                  | **block**  |
| Patient ID, MRN, insurance ID           | tokenize                | tokenize   | tokenize                                          | redact                      | redact                  | tokenize   |
| IP / MAC / internal URL                 | tokenize                | redact     | redact                                            | redact                      | tokenize                | redact     |
| Public URL                              | allow                   | redact     | allow                                             | allow                       | allow                   | allow      |
| AGE                                     | allow                   | allow      | allow                                             | allow                       | allow                   | allow      |
| Unexpected data in AI output            | warn (secrets redacted) | redact     | redact                                            | redact (cards block)        | warn (secrets redacted) | redact     |
| Purpose rules                           | –                       | –          | clinical-analysis, patient-communication, billing | fraud-analysis              | –                       | –          |

See the exact rules in [`src/policy/built-in-policies.ts`](../../src/policy/built-in-policies.ts), or run `npx aran policies list`.

## 7.3 Choosing a policy

| Your situation                                                  | Start with   |
| --------------------------------------------------------------- | ------------ |
| General chatbot or assistant                                    | `default`    |
| Regulated data, or "nothing risky may leave"                    | `strict`     |
| Hospitals, clinics, health apps                                 | `healthcare` |
| Banks, payments, fintech                                        | `financial`  |
| Sending code, logs or stack traces to an AI                     | `developer`  |
| Internal company assistant (hide infrastructure, block secrets) | `enterprise` |

Then customise (7.4–7.6).

## 7.4 Quick custom policy (shorthand)

Pass `{ TYPE: action }`. Everything you don't mention comes from the `default` policy:

```ts
const aran = new Aran({ policy: { PERSON: "pseudonymize", PHONE: "allow", PASSWORD: "block" } });
console.log(
  (await aran.protect({ type: "text", data: "Call John Smith on +91 98765 43210" })).safeData,
);
```

```text
Call Reese Hayes on +91 98765 43210
```

The name became a realistic fake (pseudonymize), and the phone number was allowed. Pseudonyms are restored in `release()` just like tokens.

## 7.5 Full custom policy in code

```ts
const aran = new Aran({
  policy: {
    name: "support-desk",
    extends: "default", // start from a built-in policy
    failMode: "closed",
    minConfidence: 0.5,
    defaultAction: "redact", // for types without a rule (e.g. custom types)
    entities: {
      PERSON: "tokenize",
      EMAIL: { action: "tokenize", restore: false }, // tokenized, but never put back in answers
      PHONE: { action: "redact", minConfidence: 0.8 },
      CREDIT_CARD: "block",
    },
    output: {
      restoreTokens: true,
      unexpectedEntityAction: "redact",
      entities: { API_KEY: "block" },
    },
  },
});
```

Actions are case-insensitive: `"REDACT"` works too.

## 7.6 YAML / JSON policy files

`policies/clinic.yaml`:

```yaml
name: cardiology-clinic
extends: healthcare
entities:
  PERSON: tokenize
  PASSWORD: redact # this clinic redacts passwords instead of blocking
purposes:
  - id: cardiology
    description: Risk scoring needs vitals and age, not identity.
    keywords: [cardio, heart, blood pressure]
    entities:
      PERSON: redact
      PATIENT_ID: redact
      AGE: allow
```

Load it:

```ts
import { Aran, loadPolicyFile } from "aiaran";

const aran = new Aran({ policy: await loadPolicyFile("policies/clinic.yaml") });
```

From a string (e.g. stored in a database):

```ts
import { parsePolicyText, resolvePolicy } from "aiaran";

const policy = resolvePolicy(parsePolicyText(yamlText) as never);
const aran = new Aran({ policy });
```

JSON works the same way (`clinic.json`). Policy files are parsed safely: no custom YAML tags, a limit on aliases, and no prototype keys. Invalid files throw `PolicyError`, listing every problem.

## 7.7 Output rules

The `output` section controls `release()`:

| Field                    | Values                                         | Meaning                                                                       |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `restoreTokens`          | `true` / `false`                               | Put original values back into the AI's answer.                                |
| `unexpectedEntityAction` | `allow`, `warn`, `redact`, `tokenize`, `block` | What to do with sensitive values in the answer that ARAN did not place there. |
| `entities`               | `{ TYPE: action }`                             | Per-type overrides of the above.                                              |

- `warn` keeps the value and sets `status: "warned"`.
- `block` makes `release()` return `data: null` and `status: "blocked"`, and makes `restore()` throw `BlockedError`.
- Types your policy **allows** in input (like `AGE`) are never treated as leaks in output.
- Per-entity `restore: false` (7.5) keeps that type's tokens in the answer.

## 7.8 Purpose-based minimization

A **purpose** says why you are calling the AI. Policies can contain purpose rules that remove more data when it isn't needed for that purpose.

```ts
const note =
  "Patient John Smith (patient ID P123456), age 52, phone +91 98765 43210, BP 150/95. Portal password: Hunter2025!";

await aran.protect({ type: "text", data: note });
await aran.protect({ type: "text", data: note, purpose: "Estimate cardiovascular risk" });
```

With the clinic policy from 7.6:

```text
no purpose  : Patient [PERSON_001] (patient ID [PATIENT_ID_001]), age 52, phone [PHONE_REDACTED], BP 150/95. Portal password: [PASSWORD_REDACTED]
with purpose: Patient [PERSON_REDACTED] (patient ID [PATIENT_ID_REDACTED]), age 52, phone [PHONE_REDACTED], BP 150/95. Portal password: [PASSWORD_REDACTED]
explanation : {
  purpose: 'Estimate cardiovascular risk',
  matchedRule: 'cardiology',
  reason: 'Purpose matched rule "cardiology": Risk scoring needs vitals and age, not identity.',
  removed: [ 'PERSON', 'PATIENT_ID', 'PHONE', 'PASSWORD' ],
  retained: [ 'AGE' ],
  tokenized: [],
  blocked: []
}
```

**How a purpose is matched (deterministic, no AI involved):**

1. If the purpose equals a rule's `id` (case-insensitive), that rule is used.
2. Otherwise, the rule with the **longest keyword** contained in the purpose wins. For example, `"patient communication: summarise the visit"` picks `patient-communication` (keyword "patient communication") over `clinical-analysis` (keyword "summar").
3. If nothing matches, the base policy applies, and `minimization.reason` says so, along with a `PURPOSE_NOT_MATCHED` notice.

The `healthcare` policy's built-in purposes:

| Rule id                 | Example purposes                                                                  | Effect                                                               |
| ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `clinical-analysis`     | "analyze cardiovascular risk", "summarize medical condition", "diagnosis support" | identity, IDs and contact details are **removed**; age is kept       |
| `patient-communication` | "letter to patient", "appointment reminder", "discharge instructions"             | name, provider and patient ID **tokenized** (restored in the answer) |
| `billing`               | "insurance claim", "billing question"                                             | insurance ID, patient ID and name tokenized                          |

Use `result.minimization` and `result.actions[i].reason` (`"purpose"`, `"policy"` or `"default"`) to show users or auditors exactly why each value was handled the way it was.

## 7.9 Your own entity types

### A regular expression

```ts
const aran = new Aran({ policy: { EMPLOYEE_ID: "tokenize" } });
aran.entities.register({
  name: "EMPLOYEE_ID", // UPPER_SNAKE_CASE
  description: "Internal staff number",
  detector: /\bEMP-\d{5}\b/,
});
```

### A pattern that needs a nearby keyword

```ts
aran.entities.register({
  name: "CASE_NUMBER",
  defaultAction: "redact", // used when the policy has no rule for it
  detector: {
    pattern: /\b\d{6}\b/,
    confidence: 0.9,
    context: { keywords: ["case", "मामला"], required: true, windowBefore: 12 },
  },
});
```

Result from the demo:

```text
EMP-00421 opened case 778812; invoice 445566 is unrelated.
→ [EMPLOYEE_ID_001] opened case [CASE_NUMBER_REDACTED]; invoice 445566 is unrelated.
```

`445566` was left alone because "case" is not near it.

Context options: `keywords` (any language, lower-case), `required` (drop the match without a keyword) or a confidence `boost` (default +0.1), and `windowBefore` / `windowAfter` (how many characters to look at, default 40 / 20).

### A validation function

```ts
aran.entities.register({
  name: "VEHICLE_REG",
  detector: {
    pattern: /\b[A-Z]{2}\s?\d{2}\s?[A-Z]{1,2}\s?\d{4}\b/, // e.g. TN 09 AB 1234
    validate: (value) => !value.startsWith("XX"),
  },
});
```

### Your own detection code

```ts
aran.entities.register({
  name: "PROJECT_CODE",
  detector: ({ text }) => {
    const i = text.indexOf("Project Falcon");
    return i < 0
      ? []
      : [
          {
            id: "",
            type: "PROJECT_CODE",
            start: i,
            end: i + 14,
            confidence: 0.99,
            source: "custom",
          },
        ];
  },
});
```

Detectors return **positions, never values**. A detector that throws produces a `DETECTOR_FAILED` warning, and the result becomes `uncertain` (it never crashes the request).

## 7.10 Validating policies

From the command line:

```bash
npx aran policy validate policies/clinic.yaml
```

```text
Policy "cardiology-clinic" is valid.
```

An invalid file:

```text
ERROR    entities.PERSON: Invalid action "explode".
ERROR    entities.__proto__: Entity type names must be UPPER_SNAKE_CASE.
Policy is invalid (2 error(s)).
```

The exit code is 2 for an invalid policy, so you can add the command to CI. In code:

```ts
import { parsePolicyText, validatePolicyDefinition } from "aiaran";

const issues = validatePolicyDefinition(
  parsePolicyText(text),
  new Set(aran.entities.list().map((e) => e.name)),
);
for (const i of issues) console.log(i.severity, i.path, i.message);
```

---

← [6. Word (.docx)](06-word-docx.md) · Next: [8. AI providers →](08-ai-providers.md)
