/** Checksum and plausibility validators used to reduce false positives. */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Luhn (mod 10) checksum — payment cards, IMEI, NPI (with prefix). */
export function luhnValid(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 2) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isPlausibleCardNumber(value: string): boolean {
  const d = digitsOnly(value);
  if (d.length < 13 || d.length > 19) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  const known =
    /^4/.test(d) || // Visa
    /^5[1-5]/.test(d) || // Mastercard
    /^2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)/.test(d) || // Mastercard 2-series
    /^3[47]/.test(d) || // Amex
    /^3(0[0-5]|[68])/.test(d) || // Diners
    /^35(2[89]|[3-8]\d)/.test(d) || // JCB
    /^6(011|5|4[4-9])/.test(d) || // Discover
    /^(508|60|65|81|82|353|356)/.test(d) || // RuPay
    /^62/.test(d) || // UnionPay
    /^(5018|5020|5038|56|57|58|6304|6759|676[1-3])/.test(d); // Maestro
  return known && luhnValid(d);
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9] as const;

/** Verhoeff checksum — used by Aadhaar numbers. */
export function verhoeffValid(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length === 0) return false;
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    const n = Number(reversed[i]);
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![n]!]!;
  }
  return c === 0;
}

/** Compute the Verhoeff check digit for a digit string (used for synthetic test data). */
export function verhoeffCheckDigit(digits: string): number {
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    const n = Number(reversed[i]);
    c = VERHOEFF_D[c]![VERHOEFF_P[(i + 1) % 8]![n]!]!;
  }
  return VERHOEFF_INV[c]!;
}

export function isPlausibleAadhaar(value: string): boolean {
  const d = digitsOnly(value);
  return d.length === 12 && /^[2-9]/.test(d) && !/^(\d)\1+$/.test(d) && verhoeffValid(d);
}

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  TN: 24,
  TR: 26,
  UA: 29,
  VG: 24,
  XK: 20,
};

/** ISO 13616 IBAN validation (country length + mod-97). */
export function ibanValid(value: string): boolean {
  const iban = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return false;
  if (expected === undefined && (iban.length < 15 || iban.length > 34)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const chunk = code >= 65 ? String(code - 55) : ch;
    for (const digit of chunk) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

export function ssnValid(value: string): boolean {
  const d = digitsOnly(value);
  if (d.length !== 9) return false;
  const area = d.slice(0, 3);
  const group = d.slice(3, 5);
  const serial = d.slice(5);
  if (area === "000" || area === "666" || area.startsWith("9")) return false;
  if (group === "00" || serial === "0000") return false;
  return true;
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Heuristic: looks like a machine-generated secret rather than a word or placeholder. */
export function looksLikeSecret(value: string, minEntropy = 3.0): boolean {
  if (value.length < 8) return false;
  if (
    /^(x+|\*+|\.+|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|your[_-]?\w*|changeme|password|secret|example|placeholder|redacted|null|none|undefined|true|false)$/i.test(
      value,
    )
  ) {
    return false;
  }
  if (/^\[[A-Z_]+_\d+\]$/.test(value)) return false; // ARAN token
  return shannonEntropy(value) >= minEntropy;
}

export function jwtLooksValid(value: string): boolean {
  const [header] = value.split(".");
  if (!header) return false;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as unknown;
    return typeof decoded === "object" && decoded !== null && "alg" in decoded;
  } catch {
    return false;
  }
}
