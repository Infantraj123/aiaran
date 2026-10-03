import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { Aran, type OcrEngine } from "../../src/index.js";
import { makeImage } from "../../scripts/fixtures.mjs";
import { S } from "../helpers/synthetic.js";

const aran = new Aran({ policy: "healthcare", logger: false });
afterAll(() => aran.dispose());

describe("image → OCR → protection", () => {
  it("redacts text in an image using local OCR", async () => {
    const png = await makeImage([
      `Patient: ${S.name}`,
      `Email: ${S.email}`,
      "Patient ID P123456, age 52",
    ]);
    const r = await aran.protect({
      type: "image",
      data: png,
      filename: "scan.png",
      mimeType: "image/png",
    });
    expect(r.status).toBe("safe");
    const data = r.safeData!;
    expect(data.mimeType).toBe("image/png");
    expect(data.text).toContain("[PERSON_001]");
    expect(data.text).toContain("[EMAIL_REDACTED]");
    expect(data.text).not.toContain(S.email);
    // Every image entity carries a bounding box.
    expect(r.detectedEntities.every((e) => e.boundingBox && e.boundingBox.width > 0)).toBe(true);

    // The redacted image must no longer OCR to the original values.
    const second = await aran.scan({ type: "image", data: data.image });
    expect(
      second.detectedEntities.filter((e) => e.type === "EMAIL" || e.type === "PATIENT_ID"),
    ).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("FACES_NOT_INSPECTED");
  });

  it("strips EXIF/GPS metadata and handles JPEG/WEBP input", async () => {
    const png = await makeImage(["Hello world"]);
    const jpeg = await sharp(png)
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: "Ravi Kumar" } } })
      .toBuffer();
    expect(jpeg.includes(Buffer.from("Ravi Kumar"))).toBe(true);
    const r = await aran.protect({ type: "image", data: jpeg });
    expect(r.safeData!.image.includes(Buffer.from("Ravi Kumar"))).toBe(false);
    const meta = await sharp(r.safeData!.image).metadata();
    expect(meta.exif).toBeUndefined();
    const webp = await sharp(png).webp().toBuffer();
    expect((await aran.protect({ type: "image", data: webp })).status).toBe("safe");
  });

  it("reports OCR failure as uncertain and withholds data when fail-closed", async () => {
    const brokenOcr: OcrEngine = {
      name: "broken",
      version: "1",
      extract: () => Promise.reject(new Error("crash")),
    };
    const png = await makeImage(["anything"]);
    const closed = new Aran({ ocr: brokenOcr, failMode: "closed", logger: false });
    const r = await closed.protect({ type: "image", data: png });
    expect(r.status).toBe("uncertain");
    expect(r.safeData).toBeNull();
    expect(r.warnings.map((w) => w.message)).toContain(
      "OCR failed; the image was not fully inspected.",
    );
    const open = new Aran({ ocr: brokenOcr, failMode: "open", logger: false });
    const r2 = await open.protect({ type: "image", data: png });
    expect(r2.status).toBe("uncertain");
    expect(r2.safeData).not.toBeNull();
    await closed.dispose();
    await open.dispose();
  });

  it("reports OCR as unavailable when disabled", async () => {
    const noOcr = new Aran({ ocr: false, logger: false });
    const r = await noOcr.protect({ type: "image", data: await makeImage(["x"]) });
    expect(r.status).toBe("uncertain");
    expect(r.warnings.map((w) => w.code)).toContain("OCR_UNAVAILABLE");
    await noOcr.dispose();
  });

  it("redacts faces when a face detector is configured", async () => {
    const withFaces = new Aran({
      logger: false,
      faceDetector: {
        name: "fake",
        version: "1",
        detect: async () => [{ box: { x: 10, y: 10, width: 50, height: 50 }, confidence: 0.99 }],
      },
    });
    const r = await withFaces.protect({ type: "image", data: await makeImage(["Hello"]) });
    expect(r.detectedEntities.map((e) => e.type)).toContain("FACE");
    const { data } = await sharp(r.safeData!.image)
      .extract({ left: 20, top: 20, width: 10, height: 10 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Math.max(...data)).toBe(0); // painted black
    await withFaces.dispose();
  });
});
