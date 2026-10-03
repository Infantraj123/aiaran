import { describe, expect, it } from "vitest";
import {
  ibanValid,
  isPlausibleAadhaar,
  isPlausibleCardNumber,
  jwtLooksValid,
  looksLikeSecret,
  luhnValid,
  shannonEntropy,
  ssnValid,
  verhoeffCheckDigit,
  verhoeffValid,
} from "../../src/detection/validators.js";
import { S, aadhaar, luhnComplete } from "../helpers/synthetic.js";

describe("validators", () => {
  it("validates Luhn checksums", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(luhnValid(luhnComplete("411111111111111"))).toBe(true);
  });

  it("accepts plausible card numbers and rejects others", () => {
    expect(isPlausibleCardNumber(S.card)).toBe(true);
    expect(isPlausibleCardNumber(S.amex)).toBe(true);
    expect(isPlausibleCardNumber("1111 1111 1111 1111")).toBe(false); // repeated digits
    expect(isPlausibleCardNumber("9999 9999 9999 9995")).toBe(false); // unknown prefix
    expect(isPlausibleCardNumber("4111")).toBe(false);
  });

  it("computes and validates Verhoeff check digits", () => {
    const base = "23456789012";
    const full = base + verhoeffCheckDigit(base);
    expect(verhoeffValid(full)).toBe(true);
    const wrong = base + ((verhoeffCheckDigit(base) + 1) % 10);
    expect(verhoeffValid(wrong)).toBe(false);
    expect(isPlausibleAadhaar(aadhaar())).toBe(true);
    expect(isPlausibleAadhaar("1234 5678 9012")).toBe(false); // must start 2-9
  });

  it("validates IBANs with mod-97 and country length", () => {
    expect(ibanValid(S.iban)).toBe(true);
    expect(ibanValid(S.gbIban)).toBe(true);
    expect(ibanValid("DE89 3704 0044 0532 0130 01")).toBe(false);
    expect(ibanValid("DE89 3704 0044 0532 0130")).toBe(false); // wrong length
  });

  it("applies SSN structural rules", () => {
    expect(ssnValid(S.ssn)).toBe(true);
    expect(ssnValid("000-12-3456")).toBe(false);
    expect(ssnValid("666-12-3456")).toBe(false);
    expect(ssnValid("923-12-3456")).toBe(false);
    expect(ssnValid("123-00-3456")).toBe(false);
    expect(ssnValid("123-45-0000")).toBe(false);
  });

  it("measures entropy and recognises placeholders", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abcd")).toBe(2);
    expect(looksLikeSecret("changeme")).toBe(false);
    expect(looksLikeSecret("${API_KEY}")).toBe(false);
    expect(looksLikeSecret("[API_KEY_001]")).toBe(false);
    expect(looksLikeSecret("Q7tR2vX9mK4pL8nB3cZ6")).toBe(true);
  });

  it("checks JWT headers", () => {
    expect(jwtLooksValid(S.jwt)).toBe(true);
    expect(jwtLooksValid("eyJub3RhbGciOjF9.eyJ4IjoxfQ.sig")).toBe(false);
  });
});
