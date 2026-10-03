# Detection Reference

ARAN combines three built-in detectors with any custom detectors you add. Overlapping detections are resolved by confidence plus a small category priority (security > government > financial > healthcare > custom > identity > network > demographic); near-ties prefer the longer span.

| Detector                            | Name                 | Source   |
| ----------------------------------- | -------------------- | -------- |
| PII patterns                        | `aran.pii`           | `regex`  |
| Secrets                             | `aran.secrets`       | `secret` |
| Heuristic NER                       | `aran.ner-heuristic` | `ner`    |
| Field-name hints (structured input) | `aran.field-hints`   | `field`  |

Disable a built-in with `disableDetectors: ["aran.ner-heuristic"]`.

## Entity catalogue

| Type                    | How it is detected                                                                                                                                                                               | Validation / context                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `PERSON`                | Titles (Mr, Dr, Shri, Smt, Thiru…), labels (`Name:`, `Patient name:`, `S/O`…), cue phrases (`my name is`, `patient`…), common given names, Hindi/Tamil cues (`नाम`, `मेरा नाम`, `பெயர்`, `திரு`) | Stopword trimming; weak cues need 2+ words or a known given name                        |
| `EMAIL`                 | RFC-like pattern                                                                                                                                                                                 | –                                                                                       |
| `PHONE`                 | Indian (+91 / 10-digit mobile), NANP, international E.164                                                                                                                                        | Context words (phone, mobile, फ़ोन, தொலைபேசி) boost confidence                          |
| `ADDRESS`               | Street number + suffix (Road, Nagar, Salai, Street…), `Address:` labels, PIN/ZIP labels, `City - 600001`, `City, ST 12345`                                                                       | Labelled values must contain a digit or comma                                           |
| `DATE_OF_BIRTH`         | Dates preceded by DOB / date of birth / born / जन्म तिथि / பிறந்த தேதி                                                                                                                           | Plain dates are not flagged                                                             |
| `AGE`                   | `age 52`, `52-year-old`, `आयु`, `வயது`                                                                                                                                                           | ≤ 125                                                                                   |
| `USERNAME`              | `username:` / `login:` labels                                                                                                                                                                    | –                                                                                       |
| `FACE`                  | Configured `FaceDetector` only                                                                                                                                                                   | –                                                                                       |
| `AADHAAR`               | 12 digits (4-4-4), first digit 2–9                                                                                                                                                               | Verhoeff checksum; label keeps checksum failures at lower confidence                    |
| `PAN`                   | `AAAPA9999A` structure (4th char = holder type)                                                                                                                                                  | –                                                                                       |
| `PASSPORT`              | Labelled (`passport`, `पासपोर्ट`, `கடவுச்சீட்டு`)                                                                                                                                                | –                                                                                       |
| `DRIVER_LICENSE`        | Indian DL format; labelled values                                                                                                                                                                | –                                                                                       |
| `NATIONAL_ID`           | UK NINO; labelled national ID / voter ID / EPIC / DNI / BSN…                                                                                                                                     | –                                                                                       |
| `SSN`                   | `###-##-####`; labelled 9 digits                                                                                                                                                                 | Area/group/serial rules                                                                 |
| `CREDIT_CARD`           | 13–19 digits, grouped or contiguous                                                                                                                                                              | Luhn + issuer prefix                                                                    |
| `IBAN`                  | Country + check digits + BBAN                                                                                                                                                                    | Country length + mod-97                                                                 |
| `BANK_ACCOUNT`          | Labelled 9–18 digits (`account`, `a/c`, `खाता`, `கணக்கு`)                                                                                                                                        | –                                                                                       |
| `UPI_ID`                | `name@handle` not followed by a domain                                                                                                                                                           | Known handle → high confidence; otherwise needs UPI context                             |
| `TRANSACTION_ID`        | Labelled (`UTR`, `txn`, `reference`, `order`…)                                                                                                                                                   | Must contain a digit                                                                    |
| `PASSWORD`              | `password=`, `pwd:`, `पासवर्ड`, URL user:pass@                                                                                                                                                   | Placeholders ignored                                                                    |
| `API_KEY`               | OpenAI, Anthropic, Google, Stripe, SendGrid, npm, Hugging Face, GitLab…; `api_key=` assignments                                                                                                  | Entropy check on generic assignments                                                    |
| `ACCESS_TOKEN`          | Bearer tokens, Slack tokens, `access_token=`                                                                                                                                                     | Entropy check                                                                           |
| `JWT`                   | `eyJ….eyJ….sig`                                                                                                                                                                                  | Header decodes to JSON with `alg`                                                       |
| `PRIVATE_KEY`           | PEM private key blocks (also truncated)                                                                                                                                                          | –                                                                                       |
| `SECRET`                | AWS secret keys, `secret=`/`client_secret=`/`signing_key=` assignments                                                                                                                           | Entropy check                                                                           |
| `DATABASE_URL`          | postgres, mysql, mongodb(+srv), redis, amqp, mssql, jdbc…                                                                                                                                        | Credentials raise confidence                                                            |
| `AWS_ACCESS_KEY`        | `AKIA…`/`ASIA…` (16 chars)                                                                                                                                                                       | –                                                                                       |
| `GITHUB_TOKEN`          | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`                                                                                                                                            | –                                                                                       |
| `PATIENT_ID`            | Labelled (`patient ID`, `UHID`, `ABHA`, `मरीज़`, `நோயாளி`)                                                                                                                                       | –                                                                                       |
| `MEDICAL_RECORD_NUMBER` | `MRN`, `medical record`, `hospital no`, `IP/OP no`                                                                                                                                               | –                                                                                       |
| `INSURANCE_ID`          | `insurance`, `policy no`, `member id`, `बीमा`, `காப்பீடு`                                                                                                                                        | ≥ 5 characters                                                                          |
| `HEALTHCARE_PROVIDER`   | `… Hospital/Clinic/Medical Center/Nursing Home/…`, `अस्पताल`, `மருத்துவமனை`, labelled NPI                                                                                                        | –                                                                                       |
| `IP_ADDRESS`            | IPv4 (valid octets), IPv6                                                                                                                                                                        | Lowered after "version"/"v"                                                             |
| `MAC_ADDRESS`           | `xx:xx:…` / `xx-xx-…`                                                                                                                                                                            | Consistent separator                                                                    |
| `URL` / `INTERNAL_URL`  | http(s)/ftp/ws URLs                                                                                                                                                                              | Host classified: private, loopback, `.internal`, `.corp`, single-label → `INTERNAL_URL` |

## Structured input

For objects, field names act as strong hints (`email`, `phone`, `name`, `dob`, `ssn`, `password`, `api_key`, `iban`, `patient_id`…). If a hinted field's value is not mostly covered by detected entities, the whole value is treated as that type with confidence 0.9. Numeric values in hinted fields (for example `"phone": 9876543210`) are protected too.

## Multilingual behaviour

Patterns use Unicode-aware boundaries, so they work next to Devanagari and Tamil text. `guessLanguage()` reports `en`, `hi`, `ta` or `mixed` from the script. Detectors may declare `languages`; mixed-script text runs every detector. Contributions of context keywords and name cues for more languages are welcome.

## Writing detectors

```ts
import type { Detector } from "aiaran";

const employeeIds: Detector = {
  name: "acme.employee-id",
  version: "1.0.0",
  entityTypes: ["EMPLOYEE_ID"],
  async detect({ text }) {
    const out = [];
    for (const m of text.matchAll(/\bACME-\d{6}\b/g)) {
      out.push({
        id: "",
        type: "EMPLOYEE_ID",
        start: m.index,
        end: m.index + m[0].length,
        confidence: 0.95,
        source: "custom" as const,
      });
    }
    return out;
  },
};
```

Return offsets only, never values. Invalid spans (out of range, empty, non-numeric) are discarded, and a throwing detector produces a `DETECTOR_FAILED` warning, which makes the result `uncertain`.
