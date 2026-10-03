# Policy Reference

A policy decides what happens to each detected entity type, both in input and in AI output.

## Forms

```ts
new Aran({ policy: "healthcare" });                                   // built-in name
new Aran({ policy: { PERSON: "tokenize", EMAIL: "redact" } });        // shorthand (extends "default")
new Aran({ policy: { name: "x", extends: "strict", entities: { … } } }); // definition
new Aran({ policy: await loadPolicyFile("policy.yaml") });            // YAML / JSON file
```

## Fields

| Field                           | Type                 | Default (from `extends`) | Meaning                                                                   |
| ------------------------------- | -------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `name`                          | string               | `<base>-custom`          | Identifier used in results and logs                                       |
| `extends`                       | built-in policy name | `default`                | Base for all unspecified fields                                           |
| `description`, `version`        | string               |                          | Informational                                                             |
| `defaultAction`                 | action               | `redact`                 | Action for detected types without a rule (e.g. custom types)              |
| `minConfidence`                 | 0–1                  | policy-specific          | Entities below this confidence are ignored                                |
| `failMode`                      | `open` / `closed`    | policy-specific          | Behaviour when inspection is incomplete                                   |
| `entities`                      | map                  |                          | Per-type rule: an action string or `{ action, minConfidence?, restore? }` |
| `output.restoreTokens`          | boolean              | `true`                   | Restore tokens in AI output                                               |
| `output.unexpectedEntityAction` | output action        | policy-specific          | For sensitive values in output that ARAN did not place there              |
| `output.entities`               | map                  |                          | Per-type output action overrides                                          |
| `purposes`                      | list                 |                          | Purpose-based minimization rules (replace the base list when given)       |

**Actions** (case-insensitive): `allow`, `redact`, `tokenize`, `pseudonymize`, `block`.
**Output actions:** `allow`, `warn`, `redact`, `tokenize`, `block`.

| Action         | Payload                                                                               | Reversible               | Notes                                                                                      |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `allow`        | unchanged                                                                             | –                        | Reported in `minimization.retained`                                                        |
| `redact`       | `[EMAIL_REDACTED]`                                                                    | no                       | Original never stored                                                                      |
| `tokenize`     | `[EMAIL_001]`                                                                         | yes, if `restore` allows | Deterministic within a session                                                             |
| `pseudonymize` | realistic fake (`Avery Collins`, `user1234@example.com`, `+1 555-0142`, `192.0.2.17`) | yes                      | Fakes use reserved ranges where they exist; other types use format-preserving substitution |
| `block`        | –                                                                                     | –                        | The whole request becomes `status: "blocked"` and `safeData: null`                         |

## Purposes

```yaml
purposes:
  - id: clinical-analysis
    description: Clinical reasoning does not need direct identifiers.
    keywords: [clinical, diagnos, symptom, risk, cardio]
    entities:
      PERSON: redact
      PATIENT_ID: redact
      AGE: allow
```

A request's `purpose` matches a rule when it equals the rule `id` (case-insensitive) — an exact id always wins. Otherwise the rule with the **longest keyword** contained in the purpose wins (the most specific match); ties go to the rule listed first. Matching is intentionally simple and deterministic: ARAN makes no automatic or model-based decisions about what is "necessary". Every decision is reported:

```ts
result.minimization;
// { purpose, matchedRule, reason, removed: [...], retained: [...], tokenized: [...], blocked: [...] }
result.actions[i].reason; // "policy" | "purpose" | "default"
```

If a purpose is given but no rule matches, the base policy applies and a `PURPOSE_NOT_MATCHED` notice is added.

## Output handling

During `release()`:

- Entity types whose input action is `allow` (for example `AGE`) are not treated as leaks.
- Every other detected value gets `output.entities[type]`, falling back to `output.unexpectedEntityAction`.
- `block` withholds the whole response (`data: null`, `status: "blocked"`).
- `warn` keeps the value and sets `status: "warned"`.
- `tokenize` in output creates non-restorable tokens.

## Validation

```bash
aran policy validate policy.yaml   # exit 0 valid, 2 invalid
```

```ts
import { validatePolicyDefinition, parsePolicyText } from "aiaran";
const issues = validatePolicyDefinition(
  parsePolicyText(text),
  new Set(aran.entities.list().map((e) => e.name)),
);
```

Errors include invalid actions, invalid names, bad confidence values, unknown `extends` and forbidden keys. Unknown entity types produce warnings, because custom types may be registered at runtime.

YAML is parsed with the core schema, unique keys, no merge keys and at most 50 aliases. Documents over 1 MB are rejected.

## Built-in policies

See `aran policies list`, or [`src/policy/built-in-policies.ts`](../src/policy/built-in-policies.ts) for the exact rules.
