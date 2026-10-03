/**
 * Synthetic test data. Every value here is generated or fictitious; checksums
 * are computed so values pass validators without belonging to anyone.
 */
import { verhoeffCheckDigit } from "../../src/detection/validators.js";

/**
 * Credential-shaped test strings are assembled at runtime so that no complete
 * key-like literal is committed (avoids false alarms from secret scanners such
 * as GitHub push protection). None of these are real credentials.
 */
export function fake(prefix: string, rest: string): string {
  return prefix + rest;
}

export function aadhaar(prefix11 = "23456789012"): string {
  const full = prefix11 + verhoeffCheckDigit(prefix11);
  return `${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8)}`;
}

export function luhnComplete(partial: string): string {
  for (let d = 0; d <= 9; d++) {
    const candidate = partial + d;
    let sum = 0;
    let dbl = false;
    for (let i = candidate.length - 1; i >= 0; i--) {
      let n = Number(candidate[i]);
      if (dbl) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      dbl = !dbl;
    }
    if (sum % 10 === 0) return candidate;
  }
  throw new Error("unreachable");
}

export const S = {
  name: "Ravi Kumar",
  westernName: "Emily Carter",
  email: "ravi.kumar@example.com",
  phoneIn: "+91 98765 43210",
  phoneUs: "(415) 555-0134",
  aadhaar: aadhaar(),
  pan: "ABCPK1234F",
  ssn: "123-45-6789",
  passport: "K1234567",
  card: "4111 1111 1111 1111",
  amex: "3782 822463 10005",
  iban: "DE89 3704 0044 0532 0130 00",
  gbIban: "GB82WEST12345698765432",
  upi: "ravi.kumar@okaxis",
  ipv4: "10.20.30.40",
  publicIp: "203.0.113.7",
  ipv6: "2001:db8::8a2e:370:7334",
  mac: "00:1A:2B:3C:4D:5E",
  nino: "AB123456C",
  // Synthetic credential-shaped strings (not real keys).
  openaiKey: "sk-proj-Q7tR2vX9mK4pL8nB3cZ6wY1aE5dF0gH",
  anthropicKey: fake("sk-ant-", "api03-Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNbVcXz"),
  awsKey: fake("AKIA", "IOSFODNN7EXAMPLE"),
  awsSecret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  githubToken: fake("ghp_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"),
  googleKey: fake("AIza", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"),
  stripeKey: fake("sk_", "live_51H8xYzAbCdEfGhIjKlMnOpQr"),
  jwt:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QgVXNlciIsImlhdCI6MTUxNjIzOTAyMn0." +
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  privateKey: fake(
    "-----BEGIN RSA PRIVATE",
    " KEY-----\nMIIEowIBAAKCAQEAsyntheticKeyMaterialOnlyForTests0123456789abcdef\n-----END RSA PRIVATE KEY-----",
  ),
  dbUrl: "postgres://admin:S3cr3tPassw0rd@db.internal.example:5432/patients",
} as const;

/** All raw sensitive values, for leak assertions. */
export const SENSITIVE_VALUES: readonly string[] = [
  S.name,
  S.email,
  "98765 43210",
  S.aadhaar,
  S.pan,
  S.ssn,
  S.card,
  S.openaiKey,
  S.awsKey,
  S.githubToken,
  S.jwt,
  "S3cr3tPassw0rd",
];

export function assertNoLeak(
  serialized: string,
  values: readonly string[] = SENSITIVE_VALUES,
): string[] {
  return values.filter((v) => serialized.includes(v));
}
