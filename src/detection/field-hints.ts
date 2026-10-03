import type { EntityType } from "../entities/entity-types.js";

/**
 * Structured-data field names that strongly imply the value's entity type.
 * Used when protecting JSON objects: `{ "email": "…" }` is treated as EMAIL
 * even if the value does not match the email pattern.
 */
const FIELD_HINTS: [RegExp, EntityType][] = [
  [/^(e[-_]?mail|email[-_]?address|mail)$/i, "EMAIL"],
  [
    /^(phone|phone[-_]?(no|number)|mobile|mobile[-_]?(no|number)|tel|telephone|cell|contact[-_]?number|whatsapp)$/i,
    "PHONE",
  ],
  [
    /^((full|first|last|middle|given|family|sur|maiden|patient|customer|user|employee|account[-_]?holder|beneficiary|father|mother|spouse|guardian|nominee)[-_]?name|name|surname|fname|lname)$/i,
    "PERSON",
  ],
  [
    /^((home|street|postal|mailing|billing|shipping|residential|permanent)[-_]?address|address([-_]?line[-_]?\d)?|street|addr)$/i,
    "ADDRESS",
  ],
  [/^(dob|date[-_]?of[-_]?birth|birth[-_]?date|birthday)$/i, "DATE_OF_BIRTH"],
  [/^(user[-_]?name|login|user[-_]?id|handle|screen[-_]?name)$/i, "USERNAME"],
  [/^(aadhaar|aadhar|aadhaar[-_]?(no|number)|uid)$/i, "AADHAAR"],
  [/^(pan|pan[-_]?(no|number|card))$/i, "PAN"],
  [/^(passport|passport[-_]?(no|number))$/i, "PASSPORT"],
  [/^(driver'?s?[-_]?licen[cs]e|dl[-_]?(no|number)|driving[-_]?licen[cs]e)$/i, "DRIVER_LICENSE"],
  [/^(national[-_]?id|nin|nino|voter[-_]?id)$/i, "NATIONAL_ID"],
  [/^(ssn|social[-_]?security([-_]?number)?)$/i, "SSN"],
  [
    /^(card[-_]?(no|number)|credit[-_]?card([-_]?number)?|cc[-_]?number|pan[-_]?card[-_]?number)$/i,
    "CREDIT_CARD",
  ],
  [
    /^(account[-_]?(no|number)|bank[-_]?account([-_]?number)?|acct[-_]?(no|number))$/i,
    "BANK_ACCOUNT",
  ],
  [/^iban$/i, "IBAN"],
  [/^(upi|upi[-_]?id|vpa)$/i, "UPI_ID"],
  [/^(password|passwd|pwd|pass|passphrase|pin)$/i, "PASSWORD"],
  [/^(api[-_]?key|apikey|x[-_]?api[-_]?key)$/i, "API_KEY"],
  [
    /^(access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer[-_]?token|token|id[-_]?token)$/i,
    "ACCESS_TOKEN",
  ],
  [/^(secret|client[-_]?secret|secret[-_]?key|private[-_]?key|signing[-_]?key)$/i, "SECRET"],
  [/^(database[-_]?url|db[-_]?url|connection[-_]?string|dsn)$/i, "DATABASE_URL"],
  [/^(patient[-_]?id|uhid|abha([-_]?(no|number|id))?)$/i, "PATIENT_ID"],
  [/^(mrn|medical[-_]?record[-_]?(no|number))$/i, "MEDICAL_RECORD_NUMBER"],
  [/^(insurance[-_]?(id|no|number)|policy[-_]?(no|number)|member[-_]?id)$/i, "INSURANCE_ID"],
  [/^(ip|ip[-_]?address|client[-_]?ip|remote[-_]?addr)$/i, "IP_ADDRESS"],
  [/^(mac|mac[-_]?address)$/i, "MAC_ADDRESS"],
];

export function entityTypeForField(fieldName: string): EntityType | undefined {
  for (const [re, type] of FIELD_HINTS) if (re.test(fieldName)) return type;
  return undefined;
}
