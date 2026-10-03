import { isIP } from "node:net";
import { classifyHost } from "../security/network.js";
import { RegexDetector, WB, WE, labelled, type PatternRule } from "./regex-detector.js";
import {
  digitsOnly,
  ibanValid,
  isPlausibleAadhaar,
  isPlausibleCardNumber,
  ssnValid,
} from "./validators.js";

/**
 * Pattern-based PII detection for identity, government, financial,
 * healthcare and network identifiers. Context keywords include English,
 * Hindi and Tamil terms; patterns use Unicode-aware boundaries.
 */

const K = {
  phone: [
    "phone",
    "mobile",
    "cell",
    "tel",
    "contact",
    "call",
    "whatsapp",
    "ph.",
    "mob",
    "फ़ोन",
    "फोन",
    "मोबाइल",
    "संपर्क",
    "தொலைபேசி",
    "கைபேசி",
    "அலைபேசி",
    "தொடர்பு",
  ],
  aadhaar: ["aadhaar", "aadhar", "adhaar", "uid", "uidai", "आधार", "ஆதார்"],
  pan: ["pan", "permanent account", "पैन", "income tax"],
  ssn: ["ssn", "social security", "tin", "taxpayer"],
  card: ["card", "visa", "mastercard", "amex", "credit", "debit", "cc", "कार्ड", "அட்டை"],
  upi: ["upi", "vpa", "gpay", "phonepe", "paytm", "bhim", "यूपीआई"],
  dob: ["dob", "d.o.b", "date of birth", "birth date", "birthdate", "born", "जन्म", "பிறந்த"],
  ip: ["ip", "host", "server", "address", "addr", "client", "remote", "src", "dst"],
} as const;

const DATE = String.raw`(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})`;

const KNOWN_UPI_HANDLES = new Set([
  "upi",
  "ybl",
  "ibl",
  "axl",
  "okaxis",
  "okhdfcbank",
  "okicici",
  "oksbi",
  "paytm",
  "apl",
  "yapl",
  "ptyes",
  "ptaxis",
  "pthdfc",
  "ptsbi",
  "axisbank",
  "hdfcbank",
  "icici",
  "sbi",
  "kotak",
  "federal",
  "indus",
  "idfcbank",
  "airtel",
  "jio",
  "freecharge",
  "mobikwik",
  "postbank",
  "barodampay",
  "pnb",
  "cnrb",
  "boi",
  "unionbank",
  "rbl",
  "yesbank",
  "aubank",
  "dbs",
  "hsbc",
  "citi",
  "sc",
  "waaxis",
  "wahdfcbank",
  "wasbi",
  "waicici",
  "fbl",
  "ikwik",
  "abfspay",
  "axisb",
  "slice",
  "superyes",
]);

const ID_VALUE = String.raw`[A-Za-z]{0,6}[\-\/]?\d[A-Za-z0-9\-\/]{2,24}`;

export const PII_RULES: readonly PatternRule[] = [
  // ── Identity ──────────────────────────────────────────────────────────
  {
    type: "EMAIL",
    id: "email",
    pattern: new RegExp(
      String.raw`${WB}[A-Za-z0-9](?:[A-Za-z0-9._%+\-]{0,63})@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}${WE}`,
      "u",
    ),
    confidence: 0.95,
  },
  {
    type: "PHONE",
    id: "phone-in",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}_+])(?:(?:\+91|0091)[\s\-]?|0)?[6-9]\d{4}[\s\-]?\d{5}${WE}`,
      "u",
    ),
    confidence: 0.7,
    validate: (v) => digitsOnly(v).length >= 10,
    context: { keywords: K.phone, boost: 0.2 },
    classify: (v) =>
      /^(\+91|0091)/.test(v) ? { type: "PHONE", confidence: 0.9 } : { type: "PHONE" },
  },
  {
    type: "PHONE",
    id: "phone-nanp",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}_])(?:\+?1[\s.\-]?)?(?:\([2-9]\d{2}\)\s?|[2-9]\d{2}[\s.\-])[2-9]\d{2}[\s.\-]\d{4}${WE}`,
      "u",
    ),
    confidence: 0.75,
    context: { keywords: K.phone, boost: 0.15 },
  },
  {
    type: "PHONE",
    id: "phone-intl",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}_])\+(?:[1-9]\d{0,2})[\s.\-]?(?:\(?\d{1,4}\)?[\s.\-]?){1,4}\d{2,6}${WE}`,
      "u",
    ),
    confidence: 0.75,
    validate: (v) => {
      const n = digitsOnly(v).length;
      return n >= 8 && n <= 15;
    },
    context: { keywords: K.phone, boost: 0.15 },
  },
  {
    type: "DATE_OF_BIRTH",
    id: "dob-labelled",
    pattern: new RegExp(
      String.raw`(?:d\.?o\.?b\.?|date\s+of\s+birth|birth\s*date|born(?:\s+on)?|जन्म\s*(?:तिथि|तारीख|दिनांक)|பிறந்த\s*(?:தேதி|நாள்))\s*[:\-–]?\s*(${DATE})`,
      "iu",
    ),
    group: 1,
    confidence: 0.92,
  },
  {
    type: "AGE",
    id: "age-labelled",
    pattern:
      /(?<![\p{L}\p{N}_])(?:age[d]?|aged|आयु|उम्र|வயது)\s*(?:is|of|[:-])?\s*(\d{1,3})(?![\p{N}])/iu,
    group: 1,
    confidence: 0.85,
    validate: (v) => Number(v) <= 125,
  },
  {
    type: "AGE",
    id: "age-years-old",
    pattern: /(?<![\p{N}])(\d{1,3})[\s-]*(?:years?|yrs?|y)[\s-]*(?:old|\/o)(?![\p{L}])/iu,
    group: 1,
    confidence: 0.85,
    validate: (v) => Number(v) <= 125,
  },
  {
    type: "USERNAME",
    id: "username-labelled",
    pattern:
      /(?<![\p{L}\p{N}_])(?:user\s?name|user\s?id|login(?:\s?id)?|handle|screen\s?name)\s*(?:is|[:=])\s*["']?([A-Za-z0-9][A-Za-z0-9._@-]{2,63})/iu,
    group: 1,
    confidence: 0.85,
  },

  // ── Government ────────────────────────────────────────────────────────
  {
    type: "AADHAAR",
    id: "aadhaar",
    pattern: new RegExp(String.raw`${WB}[2-9]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}${WE}`, "u"),
    confidence: 0.9,
    validate: isPlausibleAadhaar,
    invalidConfidence: 0.7,
    context: { keywords: K.aadhaar, boost: 0.08 },
  },
  {
    type: "PAN",
    id: "pan",
    pattern: new RegExp(String.raw`${WB}[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]${WE}`, "u"),
    confidence: 0.85,
    context: { keywords: K.pan, boost: 0.1 },
  },
  {
    type: "PASSPORT",
    id: "passport-labelled",
    pattern: labelled(
      ["passport", "पासपोर्ट", "கடவுச்சீட்டு"],
      String.raw`[A-Z]{1,2}\d{6,8}|\d{9}`,
      "iu",
    ),
    group: 1,
    confidence: 0.88,
  },
  {
    type: "DRIVER_LICENSE",
    id: "dl-in",
    pattern: new RegExp(
      String.raw`${WB}[A-Z]{2}[\s\-]?\d{2}[\s\-]?(?:19|20)\d{2}[\s\-]?\d{7}${WE}`,
      "u",
    ),
    confidence: 0.8,
  },
  {
    type: "DRIVER_LICENSE",
    id: "dl-labelled",
    pattern: labelled(
      [
        "driver's license",
        "drivers license",
        "driver license",
        "driving licence",
        "driving license",
        "driver's licence",
        "dl",
        "ड्राइविंग लाइसेंस",
        "ஓட்டுநர் உரிமம்",
      ],
      String.raw`[A-Z0-9][A-Z0-9\-]{4,19}`,
      "iu",
    ),
    group: 1,
    confidence: 0.85,
    validate: (v) => /\d/.test(v),
  },
  {
    type: "NATIONAL_ID",
    id: "uk-nino",
    pattern: new RegExp(
      String.raw`${WB}(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]${WE}`,
      "u",
    ),
    confidence: 0.8,
  },
  {
    type: "NATIONAL_ID",
    id: "national-id-labelled",
    pattern: labelled(
      [
        "national id",
        "national identity",
        "national insurance",
        "nin",
        "nic",
        "citizen id",
        "voter id",
        "epic",
        "personal id",
        "personalausweis",
        "dni",
        "nie",
        "bsn",
        "codice fiscale",
        "मतदाता पहचान",
        "வாக்காளர் அடையாள",
      ],
      String.raw`[A-Z0-9][A-Z0-9\-]{5,19}`,
      "iu",
    ),
    group: 1,
    confidence: 0.82,
    validate: (v) => /\d/.test(v),
  },
  {
    type: "SSN",
    id: "ssn",
    pattern: new RegExp(String.raw`${WB}\d{3}[\- ]\d{2}[\- ]\d{4}${WE}`, "u"),
    confidence: 0.8,
    validate: ssnValid,
    context: { keywords: K.ssn, boost: 0.15 },
  },
  {
    type: "SSN",
    id: "ssn-labelled",
    pattern: labelled(["ssn", "social security"], String.raw`\d{9}`, "iu"),
    group: 1,
    confidence: 0.9,
    validate: ssnValid,
  },

  // ── Financial ─────────────────────────────────────────────────────────
  {
    type: "CREDIT_CARD",
    id: "card",
    pattern: new RegExp(
      String.raw`${WB}(?:\d{4}([ \-]?)\d{4}\1\d{4}\1\d{4}(?:\d{1,3})?|\d{4}([ \-]?)\d{6}\2\d{4,5}|\d{13,19})${WE}`,
      "u",
    ),
    confidence: 0.93,
    validate: isPlausibleCardNumber,
    context: { keywords: K.card, boost: 0.05 },
  },
  {
    type: "IBAN",
    id: "iban",
    pattern: new RegExp(String.raw`${WB}[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}${WE}`, "u"),
    confidence: 0.95,
    validate: ibanValid,
  },
  {
    type: "BANK_ACCOUNT",
    id: "bank-account-labelled",
    pattern: labelled(
      [
        "account",
        "a/c",
        "acct",
        "acc",
        "bank account",
        "account number",
        "savings account",
        "current account",
        "खाता",
        "खाता संख्या",
        "கணக்கு",
        "கணக்கு எண்",
      ],
      String.raw`\d[\d \-]{7,22}\d`,
      "iu",
    ),
    group: 1,
    confidence: 0.85,
    validate: (v) => {
      const n = digitsOnly(v).length;
      return n >= 9 && n <= 18;
    },
  },
  {
    type: "UPI_ID",
    id: "upi",
    pattern:
      /(?<![\p{L}\p{N}_.\-@])[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}(?![\p{L}\p{N}_@]|\.[A-Za-z0-9])/u,
    confidence: 0.5,
    classify: (v) => {
      const handle = v.split("@")[1]?.toLowerCase() ?? "";
      return { type: "UPI_ID", confidence: KNOWN_UPI_HANDLES.has(handle) ? 0.9 : 0.45 };
    },
    context: { keywords: K.upi, boost: 0.35 },
  },
  {
    type: "TRANSACTION_ID",
    id: "txn-labelled",
    pattern: labelled(
      [
        "transaction",
        "txn",
        "utr",
        "rrn",
        "reference",
        "ref",
        "order",
        "payment",
        "invoice",
        "लेनदेन",
        "பரிவர்த்தனை",
      ],
      String.raw`[A-Za-z0-9][A-Za-z0-9\-_]{7,39}`,
      "iu",
    ),
    group: 1,
    confidence: 0.75,
    validate: (v) => /\d/.test(v) && !/^\d{1,7}$/.test(v),
  },

  // ── Healthcare ────────────────────────────────────────────────────────
  {
    type: "PATIENT_ID",
    id: "patient-id-labelled",
    pattern: labelled(
      [
        "patient id",
        "patient",
        "pid",
        "uhid",
        "abha",
        "health id",
        "रोगी",
        "मरीज़",
        "मरीज",
        "நோயாளி",
      ],
      ID_VALUE,
      "iu",
    ),
    group: 1,
    confidence: 0.85,
    validate: (v) => v.length >= 4,
  },
  {
    type: "MEDICAL_RECORD_NUMBER",
    id: "mrn-labelled",
    pattern: labelled(
      ["mrn", "medical record", "mr", "hospital", "case", "ip", "op", "registration"],
      ID_VALUE,
      "iu",
    ),
    group: 1,
    confidence: 0.8,
    validate: (v, text, start) => {
      const before = text.slice(Math.max(0, start - 25), start).toLowerCase();
      return /(mrn|medical record|mr\s*(no|#|number)|hospital\s*(no|number|#|id)|case\s*(no|number|#|id)|(ip|op)\s*(no|number|#)|registration\s*(no|number|#))/.test(
        before,
      );
    },
  },
  {
    type: "INSURANCE_ID",
    id: "insurance-labelled",
    pattern: labelled(
      [
        "insurance",
        "insurance policy",
        "policy",
        "member id",
        "member",
        "subscriber",
        "health plan",
        "medicare",
        "medicaid",
        "beneficiary",
        "बीमा",
        "காப்பீடு",
      ],
      ID_VALUE,
      "iu",
    ),
    group: 1,
    confidence: 0.8,
    validate: (v) => v.length >= 5,
  },
  {
    type: "HEALTHCARE_PROVIDER",
    id: "npi-labelled",
    pattern: labelled(["npi"], String.raw`\d{10}`, "iu"),
    group: 1,
    confidence: 0.85,
  },

  // ── Network ───────────────────────────────────────────────────────────
  {
    type: "IP_ADDRESS",
    id: "ipv4",
    pattern:
      /(?<![\p{L}\p{N}_.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\p{L}\p{N}_]|\.\d)/u,
    confidence: 0.85,
    negativeContext: {
      pattern: /(?:^|[^\p{L}])(?:version|ver\.?|v)\s*$/u,
      windowBefore: 12,
      penalty: 0.45,
    },
    context: { keywords: K.ip, boost: 0.05 },
  },
  {
    type: "IP_ADDRESS",
    id: "ipv6",
    pattern:
      /(?<![\p{L}\p{N}_:])(?:[0-9A-Fa-f]{1,4}:){1,7}(?::|(?::[0-9A-Fa-f]{1,4}){1,7}|[0-9A-Fa-f]{1,4})(?![\p{L}\p{N}_:])/u,
    confidence: 0.85,
    validate: (v) => isIP(v) === 6 && (v.match(/:/g)?.length ?? 0) >= 2 && /[0-9a-f]{2}/i.test(v),
  },
  {
    type: "MAC_ADDRESS",
    id: "mac",
    pattern: new RegExp(
      String.raw`${WB}(?:[0-9A-Fa-f]{2}([:\-]))(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}${WE}`,
      "u",
    ),
    confidence: 0.9,
  },
  {
    type: "URL",
    id: "url",
    pattern: /(?<![\p{L}\p{N}_])(?:https?|ftp|wss?):\/\/[^\s<>"'`{}|\\^]+/iu,
    confidence: 0.6,
    trimTrailing: /[.,;:!?)\]}>'"]+$/,
    classify: (v) => {
      let host: string;
      try {
        host = new URL(v).hostname;
      } catch {
        return undefined;
      }
      return classifyHost(host) === "public"
        ? { type: "URL", confidence: 0.6 }
        : { type: "INTERNAL_URL", confidence: 0.9 };
    },
  },
];

export function createPiiDetector(): RegexDetector {
  return new RegexDetector("aran.pii", "1.0.0", PII_RULES, "regex");
}
