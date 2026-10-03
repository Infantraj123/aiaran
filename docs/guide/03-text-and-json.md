# 3. Text and JSON

Demos: [`demos/01-text.ts`](../../demos/01-text.ts), [`demos/02-json.ts`](../../demos/02-json.ts), [`demos/09-multilingual.ts`](../../demos/09-multilingual.ts)

```bash
node demos/01-text.ts
node demos/02-json.ts
node demos/09-multilingual.ts
```

- [3.1 Protect a string: step by step](#31-protect-a-string-step-by-step)
- [3.2 Restore the AI's answer](#32-restore-the-ais-answer)
- [3.3 When the AI invents personal data](#33-when-the-ai-invents-personal-data)
- [3.4 Chat conversations (multi-turn)](#34-chat-conversations-multi-turn)
- [3.5 Scan only (no changes)](#35-scan-only-no-changes)
- [3.6 JSON objects and API payloads](#36-json-objects-and-api-payloads)
- [3.7 Hindi, Tamil and mixed text](#37-hindi-tamil-and-mixed-text)
- [3.8 Logs, source code and stack traces](#38-logs-source-code-and-stack-traces)
- [3.9 What is detected in text](#39-what-is-detected-in-text)
- [3.10 Tuning detection](#310-tuning-detection)
- [3.11 Limits](#311-limits)

---

## 3.1 Protect a string: step by step

### Step 1: create an `Aran` instance

```ts
import { Aran } from "aiaran";

const aran = new Aran(); // uses the "default" policy
```

### Step 2: call `protect()`

```ts
const userInput = `Hi, I'm Ravi Kumar. My email is ravi.kumar@example.com and my phone is +91 98765 43210.
My PAN is ABCPK1234F and I paid with card 4111 1111 1111 1111.
Please summarise my last order.`;

const result = await aran.protect({ type: "text", data: userInput });
```

### Step 3: check what was found

```ts
console.log(result.status); // "safe"
console.log(result.summary); // { total: 5, counts: {...}, riskLevel: "HIGH" }
console.log(result.detectedEntities); // types, positions, confidence (no values)
console.log(result.actions); // what was done to each
```

Demo output:

```text
status    : safe
sessionId : ses_TtSRvettj05KevBtRh9gcw
risk      : HIGH { PERSON: 1, EMAIL: 1, PHONE: 1, PAN: 1, CREDIT_CARD: 1 }
ID    TYPE                    CONF   WHERE              ACTION        REPLACEMENT
E1    PERSON                  0.85   chars 8-18         tokenize      [PERSON_001]
E2    EMAIL                   0.95   chars 32-54        tokenize      [EMAIL_001]
E3    PHONE                   0.90   chars 71-86        tokenize      [PHONE_001]
E4    PAN                     0.95   chars 98-108       tokenize      [PAN_001]
E5    CREDIT_CARD             0.98   chars 130-149      redact        [CREDIT_CARD_REDACTED]
Warnings: none
```

### Step 4: send `safeData` (and only `safeData`) to the AI

```ts
console.log(result.safeData);
```

```text
Hi, I'm [PERSON_001]. My email is [EMAIL_001] and my phone is [PHONE_001].
My PAN is [PAN_001] and I paid with card [CREDIT_CARD_REDACTED].
Please summarise my last order.
```

The card number was **redacted**. The `default` policy never makes card numbers restorable.

## 3.2 Restore the AI's answer

Suppose the AI replies using the tokens it saw:

```ts
const aiAnswer =
  "Hello [PERSON_001]! Your order summary was sent to [EMAIL_001]. We will text [PHONE_001] when it ships.";

const released = await aran.release(aiAnswer, result.sessionId);
console.log(released.status); // "safe"
console.log(released.restoredTokens); // 3
console.log(released.data);
```

```text
Hello Ravi Kumar! Your order summary was sent to ravi.kumar@example.com. We will text +91 98765 43210 when it ships.
```

Or, if you only need the text:

```ts
const text = await aran.restore(aiAnswer, result.sessionId);
```

**Models sometimes change the token format.** ARAN still restores these variants: `[PERSON_001]`, `PERSON_001`, `[person_001]`, `[PERSON 001]`.

To help the model keep tokens intact, `generate()` automatically adds this instruction to the system prompt. Add it yourself if you call the model directly:

```text
Some values in the user content were replaced with placeholders such as [PERSON_001] or [EMAIL_REDACTED].
Treat each placeholder as an opaque value and reproduce placeholders exactly as written when you refer to them.
```

## 3.3 When the AI invents personal data

`release()` scans the answer **before** restoring. Values ARAN didn't place there are handled by the policy's output rules:

```ts
const leaky = await aran.release(
  "Also cc'd your colleague at priya.raman@example.org.",
  result.sessionId,
);
```

```text
status : warned | detected: [ 'EMAIL' ]
text   : Also cc'd your colleague at priya.raman@example.org.
```

Under `default`, unexpected values give `warn` (the text is kept and `status` is `"warned"`). Under `strict`, `healthcare`, `financial` and `enterprise` they are **redacted**. You can configure `block` too ([chapter 7](07-policies-and-minimization.md#77-output-rules)).

## 3.4 Chat conversations (multi-turn)

Use one session per conversation, so the model sees consistent tokens across turns:

```ts
// turn 1
const t1 = await aran.protect({ type: "text", data: userMessage1 });
let sessionId = t1.sessionId;

// turn 2, 3, …
const t2 = await aran.protect({
  type: "text",
  data: "Ravi Kumar here again, any update?",
  sessionId,
});
console.log(t2.safeData); // "[PERSON_001] here again, any update?"  ← same token as turn 1
```

A typical chat loop:

```ts
const history: { role: "user" | "assistant"; content: string }[] = []; // tokenized history only
let sessionId: string | undefined;

async function chat(userText: string): Promise<string> {
  const p = await aran.protect({
    type: "text",
    data: userText,
    ...(sessionId ? { sessionId } : {}),
  });
  if (p.safeData === null) throw new Error(`Blocked or not inspectable: ${p.status}`);
  sessionId = p.sessionId;

  history.push({ role: "user", content: p.safeData as string });
  const modelReply = await callYourModel(history); // the model only ever sees tokens
  history.push({ role: "assistant", content: modelReply }); // keep the tokenized version

  return aran.restore(modelReply, sessionId); // show the user the restored version
}

// when the conversation ends:
// await aran.destroySession(sessionId);
```

Keep the **tokenized** history for the model, and show the **restored** text to the user.

## 3.5 Scan only (no changes)

`scan()` reports what is inside the data without replacing anything or creating a session. Use it for dashboards, pre-upload checks and risk scoring:

```ts
const scan = await aran.scan({ type: "text", data: userInput });
console.log(scan.summary);
// risk: HIGH | counts: { PERSON: 1, EMAIL: 1, PHONE: 1, PAN: 1, CREDIT_CARD: 1 }
```

## 3.6 JSON objects and API payloads

Pass an object or array as `data`. ARAN walks it, protects every string (and object keys), and returns **the same shape**:

```ts
const aran = new Aran({ policy: "financial" });

const ticket = {
  ticketId: 7781,
  customer: {
    name: "Kiran Rao", // field name "name" → PERSON
    email: "kiran.rao@example.com",
    phone: 9876543210, // a number, but the field name says PHONE → protected
  },
  account_number: "50100123456789",
  message: "My UPI kiran.rao@okaxis payment (UTR 412345678901) failed twice.",
  priority: "high",
};

const result = await aran.protect({ type: "text", data: ticket });
console.log(result.safeData);
```

```json
{
  "ticketId": 7781,
  "customer": {
    "name": "[PERSON_001]",
    "email": "[EMAIL_001]",
    "phone": "[PHONE_001]"
  },
  "account_number": "[BANK_ACCOUNT_001]",
  "priority": "high",
  "message": "My UPI [UPI_ID_001] payment (UTR [TRANSACTION_ID_001]) failed twice."
}
```

If the message also contains a card number, the `financial` policy **blocks** the whole request:

```text
status: blocked
null
blocked types: [ 'CREDIT_CARD' ]
```

### Field-name hints

When a field's name clearly says what it contains, ARAN treats the whole value as that type, even if its format is unusual:

| Field names (case-insensitive, `_`/`-` optional)                                                      | Treated as                  |
| ----------------------------------------------------------------------------------------------------- | --------------------------- |
| `name`, `full_name`, `first_name`, `last_name`, `surname`, `patient_name`, `customer_name`, …         | `PERSON`                    |
| `email`, `email_address`, `mail`                                                                      | `EMAIL`                     |
| `phone`, `mobile`, `tel`, `contact_number`, `whatsapp`                                                | `PHONE`                     |
| `address`, `street`, `billing_address`, `address_line_1`, …                                           | `ADDRESS`                   |
| `dob`, `date_of_birth`, `birthday`                                                                    | `DATE_OF_BIRTH`             |
| `username`, `login`, `user_id`                                                                        | `USERNAME`                  |
| `aadhaar`, `pan`, `passport`, `ssn`, `national_id`, `voter_id`, `driving_licence`                     | the matching ID type        |
| `card_number`, `account_number`, `iban`, `upi_id`, `vpa`                                              | the matching financial type |
| `password`, `pwd`, `pin`, `api_key`, `access_token`, `secret`, `client_secret`, `database_url`, `dsn` | the matching secret type    |
| `patient_id`, `uhid`, `abha`, `mrn`, `insurance_id`, `policy_number`                                  | the matching health type    |
| `ip`, `ip_address`, `mac_address`                                                                     | network types               |

Rules for structured input:

- Numbers in hinted fields are protected and become strings (`"phone": 9876543210` → `"[PHONE_001]"`). Other numbers, booleans and `null` are kept.
- Keys that could cause prototype pollution (`__proto__`, `constructor`, `prototype`) are dropped.
- Only plain objects, arrays, strings, numbers, booleans and `null` are accepted. Dates, Buffers and class instances raise `InputValidationError`; convert them first (e.g. `JSON.parse(JSON.stringify(obj))`).
- Limits: depth 64, 100,000 nodes, 10 MB of total text (configurable, 3.11).

## 3.7 Hindi, Tamil and mixed text

Patterns work next to any script, and context words and name cues exist for **English, Hindi and Tamil**:

```text
--- language guess: hi ---
in : मरीज़ का नाम: राहुल शर्मा, फ़ोन 98765 12345, आधार 2345 6789 0124.
out: मरीज़ का नाम: [PERSON_001], फ़ोन [PHONE_REDACTED], आधार [AADHAAR_REDACTED].

--- language guess: ta ---
in : நோயாளி பெயர்: மீனா சுந்தரம், தொலைபேசி 91234 56789.
out: நோயாளி பெயர்: [PERSON_001], தொலைபேசி [PHONE_REDACTED].

--- language guess: mixed ---
in : Name: राहुल शर्मा, email rahul.sharma@example.com, आयु 45
out: Name: [PERSON_001], email [EMAIL_REDACTED], आयु 45
```

- Hindi name cues include `नाम`, `मेरा नाम`, `श्री`, `श्रीमती`, `डॉ`, `मरीज़`. Tamil cues include `பெயர்`, `என் பெயர்`, `திரு`, `திருமதி`, `டாக்டர்`, `நோயாளி`. The English labels `Name:` and `Patient name:` also work before Hindi and Tamil names.
- Phone, Aadhaar, account and DOB context words exist in all three languages (`फ़ोन`, `தொலைபேசி`, `आधार`, `ஆதார்`, `खाता`, `கணக்கு`, `जन्म तिथि`, `பிறந்த தேதி`, …).
- `guessLanguage(text)` returns `"en"`, `"hi"`, `"ta"` or `"mixed"`. You can pass `language: "hi"` as a hint, but all built-in detectors run on every script anyway.
- Other languages still get every format-based detector (emails, phone numbers, IDs, keys, cards, …), but not name or address heuristics. Add your own detector for those ([chapter 7](07-policies-and-minimization.md#79-your-own-entity-types)).

## 3.8 Logs, source code and stack traces

The `developer` policy redacts credentials, tokenizes people and infrastructure, and keeps the technical content:

```ts
const aran = new Aran({ policy: "developer" });
const r = await aran.protect({
  type: "text",
  data: `const client = new Client({ apiKey: "sk-proj-Q7tR2vX9mK4pL8nB3cZ6wY1aE5dF0gH" });
db = connect("postgres://admin:S3cr3tPassw0rd@db.internal.example:5432/patients")
2026-10-03T10:00:00Z ERROR auth failed for user=ravi_k ip=10.20.30.40
    at handler (/srv/app/auth.ts:42:13)`,
});
// apiKey → [API_KEY_REDACTED], connection string → [DATABASE_URL_REDACTED],
// ip → [IP_ADDRESS_001], and the stack trace line is unchanged.
```

Detected secret formats include OpenAI, Anthropic, Google, Stripe, GitHub, GitLab, Slack, AWS, npm, Hugging Face, SendGrid, JWTs, PEM private keys, bearer tokens, database URLs, and `password=` / `secret=` / `api_key=` assignments (with an entropy check, so placeholders like `changeme` or `${API_KEY}` are ignored).

## 3.9 What is detected in text

| Category   | Types                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Identity   | `PERSON`, `EMAIL`, `PHONE`, `ADDRESS`, `DATE_OF_BIRTH`, `USERNAME`, `AGE`                                               |
| Government | `AADHAAR`, `PAN`, `PASSPORT`, `DRIVER_LICENSE`, `NATIONAL_ID`, `SSN`                                                    |
| Financial  | `CREDIT_CARD`, `BANK_ACCOUNT`, `IBAN`, `UPI_ID`, `TRANSACTION_ID`                                                       |
| Security   | `PASSWORD`, `API_KEY`, `ACCESS_TOKEN`, `JWT`, `PRIVATE_KEY`, `SECRET`, `DATABASE_URL`, `AWS_ACCESS_KEY`, `GITHUB_TOKEN` |
| Healthcare | `PATIENT_ID`, `MEDICAL_RECORD_NUMBER`, `INSURANCE_ID`, `HEALTHCARE_PROVIDER`                                            |
| Network    | `IP_ADDRESS`, `MAC_ADDRESS`, `URL`, `INTERNAL_URL`                                                                      |

How each one is detected and validated (Luhn for cards, Verhoeff for Aadhaar, mod-97 for IBAN, …) is described in [docs/detection.md](../detection.md). Run `npx aran entities list` to see the list.

**Important:** person names and addresses are found with **cues** ("Mr.", "Name:", "Patient …", "my name is …", street names, PIN/ZIP codes) and a list of common first names. A name with no cue, like "Zorawar called yesterday", may be missed. If that matters, add an ML-based detector (3.10).

## 3.10 Tuning detection

```ts
// Protect more borderline matches (more false positives, fewer misses)
new Aran({ minConfidence: 0.35 }); // or mode: "strict"

// Per-type threshold inside a policy
new Aran({
  policy: { name: "p", entities: { PHONE: { action: "tokenize", minConfidence: 0.8 } } },
});

// Turn off a built-in detector, e.g. the name/address heuristics
new Aran({ disableDetectors: ["aran.ner-heuristic"] });

// Add your own detector (e.g. a local ML NER model)
aran.addDetector({
  name: "my.ner",
  version: "1.0.0",
  entityTypes: ["PERSON"],
  async detect({ text }) {
    const spans = await myNerModel(text); // [{ start, end, score }]
    return spans.map((s) => ({
      id: "",
      type: "PERSON",
      start: s.start,
      end: s.end,
      confidence: s.score,
      source: "ner" as const,
    }));
  },
});
```

Each detected entity has a `confidence` between 0 and 1, and anything below the policy threshold is ignored. A `LOW_CONFIDENCE_ENTITY` notice tells you how many candidates were skipped.

## 3.11 Limits

| Limit                | Default | Option                  |
| -------------------- | ------- | ----------------------- |
| text size            | 10 MB   | `limits.maxTextBytes`   |
| JSON depth           | 64      | `limits.maxObjectDepth` |
| JSON nodes           | 100,000 | `limits.maxObjectNodes` |
| entities per request | 100,000 | `limits.maxEntities`    |
| time per request     | 120 s   | `limits.timeoutMs`      |

```ts
new Aran({ limits: { maxTextBytes: 2 * 1024 * 1024, timeoutMs: 30_000 } });
```

Going over a size limit throws `SecurityError` (the message never contains your text).

Performance on a laptop: 100 KB of text ≈ 45 ms, 1 MB ≈ 0.4 s ([benchmarks](../benchmarks.md)).

---

← [2. Core concepts](02-core-concepts.md) · Next: [4. Images →](04-images.md)
