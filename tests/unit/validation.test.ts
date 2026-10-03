import { describe, expect, it } from "vitest";
import {
  InputValidationError,
  SecurityError,
  UnsupportedFormatError,
} from "../../src/core/errors.js";
import {
  DEFAULT_LIMITS,
  Deadline,
  resolveLimits,
  Semaphore,
  withTimeout,
} from "../../src/security/limits.js";
import {
  extensionOf,
  inputTypeForExtension,
  isDangerousKey,
  sniffFormat,
  validateFile,
} from "../../src/security/validation.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from("%PDF-1.7\n%...");
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.from("RIFF\0\0\0\0WEBPVP8 ");
const TIFF = Buffer.from([0x49, 0x49, 0x2a, 0x00]);

describe("magic-byte sniffing", () => {
  it.each([
    [PNG, "png"],
    [JPEG, "jpeg"],
    [WEBP, "webp"],
    [TIFF, "tiff"],
    [PDF, "pdf"],
    [ZIP, "zip"],
    [OLE, "ole"],
    [Buffer.from("hello"), "unknown"],
  ])("identifies %#", (bytes, format) => {
    expect(sniffFormat(bytes)).toBe(format);
  });
});

describe("validateFile", () => {
  it("accepts matching content, MIME type and extension", () => {
    expect(
      validateFile(
        { type: "image", data: PNG, mimeType: "image/png", filename: "a.png" },
        DEFAULT_LIMITS,
      ).format,
    ).toBe("png");
    expect(validateFile({ type: "pdf", data: new Uint8Array(PDF) }, DEFAULT_LIMITS).format).toBe(
      "pdf",
    );
  });

  it("does not trust extensions or declared MIME types", () => {
    expect(() =>
      validateFile({ type: "image", data: PDF, filename: "x.png" }, DEFAULT_LIMITS),
    ).toThrow(UnsupportedFormatError);
    expect(() =>
      validateFile({ type: "image", data: PNG, mimeType: "image/jpeg" }, DEFAULT_LIMITS),
    ).toThrow(InputValidationError);
    expect(() =>
      validateFile({ type: "image", data: PNG, filename: "evil.exe" }, DEFAULT_LIMITS),
    ).toThrow(InputValidationError);
  });

  it("rejects legacy .doc with a clear error", () => {
    expect(() =>
      validateFile({ type: "docx", data: OLE, filename: "old.doc" }, DEFAULT_LIMITS),
    ).toThrow(/Legacy binary \.doc/);
  });

  it("enforces size limits and rejects empty or non-binary input", () => {
    const limits = resolveLimits({ maxFileBytes: 4 });
    expect(() => validateFile({ type: "image", data: PNG }, limits)).toThrow(SecurityError);
    expect(() => validateFile({ type: "image", data: Buffer.alloc(0) }, DEFAULT_LIMITS)).toThrow(
      InputValidationError,
    );
    expect(() => validateFile({ type: "image", data: "png" as never }, DEFAULT_LIMITS)).toThrow(
      InputValidationError,
    );
  });

  it("handles path-like filenames safely", () => {
    expect(extensionOf("../../etc/passwd")).toBe("");
    expect(extensionOf("C:\\docs\\report.PDF")).toBe("pdf");
    expect(extensionOf(".bashrc")).toBe("");
    expect(inputTypeForExtension("docx")).toBe("docx");
  });

  it("flags prototype-pollution keys", () => {
    expect(isDangerousKey("__proto__")).toBe(true);
    expect(isDangerousKey("constructor")).toBe(true);
    expect(isDangerousKey("name")).toBe(false);
  });
});

describe("limits and timeouts", () => {
  it("validates limit overrides", () => {
    expect(() => resolveLimits({ maxFileBytes: -1 })).toThrow(RangeError);
    expect(resolveLimits({ maxPdfPages: 5 }).maxPdfPages).toBe(5);
  });

  it("times out slow work and calls the abort hook", async () => {
    let aborted = false;
    await expect(
      withTimeout("op", new Promise(() => {}), 10, () => (aborted = true)),
    ).rejects.toThrow(/exceeded/);
    expect(aborted).toBe(true);
  });

  it("enforces request deadlines", async () => {
    const d = new Deadline("x", 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(() => d.check()).toThrow(/exceeded/);
  });

  it("bounds concurrency", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        sem.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});
