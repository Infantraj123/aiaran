import { describe, expect, it } from "vitest";
import { createPiiDetector } from "../../src/detection/pii-detector.js";
import { found } from "../helpers/detect.js";
import { S, aadhaar } from "../helpers/synthetic.js";

const pii = createPiiDetector();

describe("PII detector — identity", () => {
  it("detects emails", async () => {
    expect(await found(pii, `Mail ${S.email} today`)).toContain(`EMAIL=${S.email}`);
  });

  it("detects Indian phone numbers in several formats", async () => {
    for (const phone of ["+91 98765 43210", "+91-9876543210", "09876543210", "98765 43210"]) {
      expect(await found(pii, `call me on ${phone}.`)).toContain(`PHONE=${phone}`);
    }
  });

  it("detects US and international phone numbers", async () => {
    expect(await found(pii, `Phone: ${S.phoneUs}`)).toContain(`PHONE=${S.phoneUs}`);
    expect(await found(pii, "Tel +44 20 7946 0958")).toContain("PHONE=+44 20 7946 0958");
  });

  it("detects labelled dates of birth but not arbitrary dates", async () => {
    expect(await found(pii, "DOB: 14/02/1984")).toContain("DATE_OF_BIRTH=14/02/1984");
    expect(await found(pii, "Date of birth 3 March 1990")).toContain("DATE_OF_BIRTH=3 March 1990");
    expect(await found(pii, "जन्म तिथि: 01-01-1990")).toContain("DATE_OF_BIRTH=01-01-1990");
    expect(
      (await found(pii, "Meeting on 14/02/2026")).filter((f) => f.startsWith("DATE_OF_BIRTH")),
    ).toEqual([]);
  });

  it("detects ages", async () => {
    expect(await found(pii, "age 52")).toContain("AGE=52");
    expect(await found(pii, "a 47-year-old male")).toContain("AGE=47");
  });

  it("detects labelled usernames", async () => {
    expect(await found(pii, "username: ravi_k99")).toContain("USERNAME=ravi_k99");
  });
});

describe("PII detector — government identifiers", () => {
  it("detects valid Aadhaar numbers and rejects invalid checksums without context", async () => {
    const valid = aadhaar("98765432101");
    expect(await found(pii, `ID ${valid}`)).toContain(`AADHAAR=${valid}`);
    const invalidDigits = valid.slice(0, -1) + String((Number(valid.slice(-1)) + 1) % 10);
    expect(
      (await found(pii, `ref ${invalidDigits}`)).filter((f) => f.startsWith("AADHAAR")),
    ).toEqual([]);
    // With an explicit label, a checksum-failing value is still flagged (lower confidence).
    expect(await found(pii, `Aadhaar: ${invalidDigits}`)).toContain(`AADHAAR=${invalidDigits}`);
  });

  it("detects PAN numbers", async () => {
    expect(await found(pii, `PAN ${S.pan}`)).toContain(`PAN=${S.pan}`);
    expect((await found(pii, "code ABCDE1234F")).filter((f) => f.startsWith("PAN"))).toEqual([]); // 4th char invalid
  });

  it("detects labelled passports", async () => {
    expect(await found(pii, `Passport No: ${S.passport}`)).toContain(`PASSPORT=${S.passport}`);
    expect(await found(pii, "पासपोर्ट: K7654321")).toContain("PASSPORT=K7654321");
  });

  it("detects SSNs with structural validation", async () => {
    expect(await found(pii, `SSN ${S.ssn}`)).toContain(`SSN=${S.ssn}`);
    expect((await found(pii, "ref 000-12-3456")).filter((f) => f.startsWith("SSN"))).toEqual([]);
  });

  it("detects UK National Insurance numbers and driver licences", async () => {
    expect(await found(pii, `NI ${S.nino}`)).toContain(`NATIONAL_ID=${S.nino}`);
    expect(await found(pii, "DL TN-01 2015 1234567 issued")).toContain(
      "DRIVER_LICENSE=TN-01 2015 1234567",
    );
    expect(await found(pii, "Driver's license: D1234-5678")).toContain("DRIVER_LICENSE=D1234-5678");
  });
});

describe("PII detector — financial", () => {
  it("detects Luhn-valid cards only", async () => {
    expect(await found(pii, `card ${S.card} exp 12/29`)).toContain(`CREDIT_CARD=${S.card}`);
    expect(await found(pii, `amex ${S.amex}`)).toContain(`CREDIT_CARD=${S.amex}`);
    expect(
      (await found(pii, "order 4111 1111 1111 1112")).filter((f) => f.startsWith("CREDIT_CARD")),
    ).toEqual([]);
  });

  it("detects IBANs", async () => {
    expect(await found(pii, `IBAN ${S.iban}`)).toContain(`IBAN=${S.iban}`);
    expect(await found(pii, `pay ${S.gbIban}`)).toContain(`IBAN=${S.gbIban}`);
  });

  it("detects labelled bank accounts", async () => {
    expect(await found(pii, "Account number: 123456789012")).toContain("BANK_ACCOUNT=123456789012");
    expect(await found(pii, "खाता संख्या 50100123456789")).toContain("BANK_ACCOUNT=50100123456789");
  });

  it("detects UPI IDs with known handles, but not emails", async () => {
    expect(await found(pii, `UPI: ${S.upi}`)).toContain(`UPI_ID=${S.upi}`);
    expect((await found(pii, `mail ${S.email}`)).filter((f) => f.startsWith("UPI_ID"))).toEqual([]);
  });

  it("detects labelled transaction references", async () => {
    expect(await found(pii, "UTR: 412345678901")).toContain("TRANSACTION_ID=412345678901");
    expect(await found(pii, "Transaction ID TXN-2026-0042AB")).toContain(
      "TRANSACTION_ID=TXN-2026-0042AB",
    );
  });
});

describe("PII detector — healthcare", () => {
  it("detects patient IDs, MRNs and insurance IDs", async () => {
    expect(await found(pii, "patient ID P123456")).toContain("PATIENT_ID=P123456");
    expect(await found(pii, "UHID: KMC-2026-00042")).toContain("PATIENT_ID=KMC-2026-00042");
    expect(await found(pii, "MRN: 00123456")).toContain("MEDICAL_RECORD_NUMBER=00123456");
    expect(await found(pii, "Insurance policy no HLT-99887766")).toContain(
      "INSURANCE_ID=HLT-99887766",
    );
    expect(await found(pii, "NPI 1234567893")).toContain("HEALTHCARE_PROVIDER=1234567893");
  });

  it("does not treat clinical measurements as identifiers", async () => {
    const results = await found(pii, "blood pressure 150/95, pulse 72, temp 98.6");
    expect(results.filter((r) => !r.startsWith("AGE"))).toEqual([]);
  });
});

describe("PII detector — network", () => {
  it("detects IPv4/IPv6/MAC addresses", async () => {
    expect(await found(pii, `server ${S.ipv4} down`)).toContain(`IP_ADDRESS=${S.ipv4}`);
    expect(await found(pii, `host ${S.ipv6}`)).toContain(`IP_ADDRESS=${S.ipv6}`);
    expect(await found(pii, `mac ${S.mac}`)).toContain(`MAC_ADDRESS=${S.mac}`);
  });

  it("does not treat version numbers or times as IPs", async () => {
    expect(
      (await found(pii, "upgrade to version 1.2.3.4")).filter((f) => f.startsWith("IP")),
    ).toEqual([]);
    expect((await found(pii, "at 12:30:45 today")).filter((f) => f.startsWith("IP"))).toEqual([]);
  });

  it("classifies URLs as public or internal", async () => {
    expect(await found(pii, "see https://example.com/docs.")).toContain(
      "URL=https://example.com/docs",
    );
    expect(await found(pii, "see http://intranet.corp/hr/records")).toContain(
      "INTERNAL_URL=http://intranet.corp/hr/records",
    );
    expect(await found(pii, "admin at http://192.168.1.10:8080/")).toContain(
      "INTERNAL_URL=http://192.168.1.10:8080/",
    );
  });
});
