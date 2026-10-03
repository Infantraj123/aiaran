/** PDF inspection helpers for tests (pdfjs-dist). */
async function open(data: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  return { task, doc: await task.promise };
}

/** Extract the text layer and metadata of a PDF. */
export async function pdfTextAndInfo(
  data: Buffer,
): Promise<{ text: string; info: Record<string, unknown>; pages: number }> {
  const { task, doc } = await open(data);
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
  }
  const meta = await doc.getMetadata();
  const pages = doc.numPages;
  await task.destroy();
  return { text, info: meta.info as Record<string, unknown>, pages };
}

/** Report active content in a PDF by reading the catalog's name trees directly. */
export async function pdfActiveContent(
  data: Buffer,
): Promise<{ js: boolean; attachments: boolean }> {
  const { PDFDocument, PDFDict, PDFName } = await import("pdf-lib");
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const openAction = doc.catalog.has(PDFName.of("OpenAction")) || doc.catalog.has(PDFName.of("AA"));
  return {
    js: Boolean(names?.has(PDFName.of("JavaScript"))) || openAction,
    attachments: Boolean(names?.has(PDFName.of("EmbeddedFiles"))),
  };
}
