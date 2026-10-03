import { afterAll, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import {
  Aran,
  DocumentProcessingError,
  InputValidationError,
  SecurityError,
  UnsupportedFormatError,
} from "../../src/index.js";
import { makeDocx, makeImage } from "../../scripts/fixtures.mjs";
import { pdfActiveContent, pdfTextAndInfo } from "../helpers/pdf.js";

const aran = new Aran({ logger: false });
afterAll(() => aran.dispose());

const CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const DOC =
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>';

describe("malicious archives (DOCX)", () => {
  it("rejects zip bombs by compression ratio", async () => {
    const bomb = Buffer.from(
      zipSync(
        {
          "[Content_Types].xml": strToU8(CONTENT_TYPES),
          "word/document.xml": strToU8(DOC),
          "word/bomb.bin": new Uint8Array(30 * 1024 * 1024),
        },
        { level: 9 },
      ),
    );
    expect(bomb.length).toBeLessThan(200 * 1024);
    await expect(aran.protect({ type: "docx", data: bomb })).rejects.toThrow(SecurityError);
  });

  it("rejects archives exceeding the uncompressed size or entry limits", async () => {
    const small = new Aran({
      logger: false,
      limits: { maxUncompressedBytes: 1024, maxZipEntries: 3 },
    });
    const big = makeDocx({ paragraphs: ["x".repeat(5000)] });
    await expect(small.protect({ type: "docx", data: big })).rejects.toThrow(SecurityError);
    const many = Buffer.from(
      zipSync(
        Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.xml`, strToU8("x")])),
      ),
    );
    await expect(small.protect({ type: "docx", data: many })).rejects.toThrow(SecurityError);
    await small.dispose();
  });

  it("rejects path traversal entries", async () => {
    const evil = Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8(CONTENT_TYPES),
        "word/document.xml": strToU8(DOC),
        "../../evil.sh": strToU8("rm -rf /"),
      }),
    );
    await expect(aran.protect({ type: "docx", data: evil })).rejects.toThrow(SecurityError);
  });

  it("rejects macro-enabled documents, DTDs, non-Word zips and legacy .doc", async () => {
    const macro = Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8(
          CONTENT_TYPES.replace("document.main", "document.macroEnabled.main"),
        ),
        "word/document.xml": strToU8(DOC),
        "word/vbaProject.bin": new Uint8Array([1]),
      }),
    );
    await expect(aran.protect({ type: "docx", data: macro })).rejects.toThrow(
      UnsupportedFormatError,
    );
    const xxe = Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8(CONTENT_TYPES),
        "word/document.xml": strToU8(
          '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>' +
            DOC.slice(21),
        ),
      }),
    );
    await expect(aran.protect({ type: "docx", data: xxe })).rejects.toThrow(
      DocumentProcessingError,
    );
    const plainZip = Buffer.from(zipSync({ "readme.txt": strToU8("hello") }));
    await expect(aran.protect({ type: "docx", data: plainZip })).rejects.toThrow(
      UnsupportedFormatError,
    );
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(aran.protect({ type: "docx", data: ole })).rejects.toThrow(UnsupportedFormatError);
  });

  it("rejects corrupt archives with a typed error", async () => {
    const corrupt = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100, 0xff)]);
    await expect(aran.protect({ type: "docx", data: corrupt })).rejects.toThrow(
      DocumentProcessingError,
    );
  });
});

describe("malicious PDFs", () => {
  it("rejects malformed PDFs with a typed error", async () => {
    const junk = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 0x41)]);
    await expect(aran.protect({ type: "pdf", data: junk })).rejects.toThrow(
      DocumentProcessingError,
    );
  });

  it("never carries JavaScript, attachments or annotations into sanitized output", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]).drawText("Hello", { x: 20, y: 250 });
    doc.addJavaScript("evil", 'app.alert("pwned")');
    await doc.attach(Buffer.from("secret attachment"), "secret.txt", { mimeType: "text/plain" });
    const input = Buffer.from(await doc.save());
    expect(await pdfActiveContent(input)).toEqual({ js: true, attachments: true });
    const r = await aran.protect({ type: "pdf", data: input, mode: "document" });
    const out = r.safeData!.document!;
    expect(await pdfActiveContent(out)).toEqual({ js: false, attachments: false });
    expect(out.includes(Buffer.from("JavaScript"))).toBe(false);
    expect((await pdfTextAndInfo(out)).text.trim()).toBe("");
  });
});

describe("malicious images and type confusion", () => {
  it("rejects images whose header declares huge dimensions", async () => {
    const png = await makeImage(["x"]);
    const forged = Buffer.from(png);
    forged.writeUInt32BE(100_000, 16); // IHDR width
    forged.writeUInt32BE(100_000, 20); // IHDR height
    await expect(aran.protect({ type: "image", data: forged })).rejects.toThrow(
      /dimensions|decoded/,
    );
  });

  it("enforces image dimension limits", async () => {
    const small = new Aran({ logger: false, limits: { maxImageDimension: 100 } });
    await expect(small.protect({ type: "image", data: await makeImage(["x"]) })).rejects.toThrow(
      SecurityError,
    );
    await small.dispose();
  });

  it("rejects truncated images", async () => {
    const png = await makeImage(["x"]);
    await expect(aran.protect({ type: "image", data: png.subarray(0, 64) })).rejects.toThrow(
      DocumentProcessingError,
    );
  });

  it("does not trust declared types (executable disguised as image/pdf)", async () => {
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]);
    await expect(aran.protect({ type: "image", data: exe, filename: "photo.png" })).rejects.toThrow(
      UnsupportedFormatError,
    );
    await expect(
      aran.protect({ type: "pdf", data: exe, mimeType: "application/pdf" }),
    ).rejects.toThrow(UnsupportedFormatError);
    const png = await makeImage(["x"]);
    await expect(aran.protect({ type: "image", data: png, filename: "photo.svg" })).rejects.toThrow(
      InputValidationError,
    );
  });

  it("enforces the file size limit", async () => {
    const small = new Aran({ logger: false, limits: { maxFileBytes: 1000 } });
    await expect(small.protect({ type: "image", data: await makeImage(["x"]) })).rejects.toThrow(
      SecurityError,
    );
    await small.dispose();
  });
});

describe("hidden text in DOCX", () => {
  const W =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const build = (body: string, extra: Record<string, string> = {}): Buffer =>
    Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8(CONTENT_TYPES),
        "word/document.xml": strToU8(
          `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
        ),
        ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
      }),
    );

  it("flags text hidden in CDATA or split by comments as not inspected", async () => {
    for (const body of [
      "<w:p><w:r><w:t><![CDATA[ravi.kumar@example.com]]></w:t></w:r></w:p>",
      "<w:p><w:r><w:t>ravi.kumar@exa<!-- x -->mple.com</w:t></w:r></w:p>",
    ]) {
      const r = await aran.protect({ type: "docx", data: build(body) });
      expect(r.status).toBe("uncertain");
      expect(r.warnings.map((w) => w.code)).toContain("DOCUMENT_STRUCTURE_UNSUPPORTED");
    }
  });

  it("protects field instructions, alt text, DrawingML text and custom XML", async () => {
    const body =
      '<w:p><w:fldSimple w:instr="HYPERLINK &quot;mailto:ravi.kumar@example.com&quot;"><w:r><w:t>mail</w:t></w:r></w:fldSimple></w:p>' +
      '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture" descr="Photo of Ravi Kumar"/><a:graphic><a:p><a:r><a:t>Call +91 98765 43210</a:t></a:r></a:p></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    const r = await aran.protect({
      type: "docx",
      data: build(body, {
        "customXml/item1.xml":
          '<?xml version="1.0"?><patient><email>ravi.kumar@example.com</email></patient>',
      }),
      mode: "document",
    });
    expect(r.status).toBe("safe");
    const files = unzipSync(new Uint8Array(r.safeData!.document!));
    const all = Object.values(files)
      .map((d) => strFromU8(d))
      .join("\n");
    expect(all).not.toContain("ravi.kumar@example.com");
    expect(all).not.toContain("Ravi Kumar");
    expect(all).not.toContain("98765");
    expect(all).toContain('descr="Photo of [PERSON_001]"');
  });

  it("flags altChunk (embedded HTML/RTF) content as not inspected", async () => {
    const r = await aran.protect({
      type: "docx",
      data: build("<w:p/>", { "word/afchunk.htm": "<p>Ravi Kumar</p>" }),
    });
    expect(r.status).toBe("uncertain");
    expect(r.warnings.map((w) => w.code)).toContain("EMBEDDED_MEDIA_NOT_INSPECTED");
  });
});
