import { strFromU8, strToU8 } from "fflate";
import { DocumentProcessingError, UnsupportedFormatError } from "../../core/errors.js";
import type { ProtectionContext } from "../../core/pipeline.js";
import { sniffFormat } from "../../security/validation.js";
import type { DocxOptions } from "../../types/configuration.js";
import type { DocumentMode } from "../../types/input.js";
import type { DocumentSafeData } from "../../types/output.js";
import { drawRedactions, normalizeImage } from "../image/image-handler.js";
import { inspectImage } from "../image/image-ocr.js";
import { buildZip, safeUnzip, type ZipEntry } from "./zip.js";
import { decodeXml, encodeXmlAttr, encodeXmlText } from "./xml.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Parts whose text content is protected. */
const TEXT_PART_RE =
  /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments(Extended|Extensible)?|glossary\/document|charts\/chart\d*|diagrams\/(data|drawing)\d*)\.xml$/;
/** Custom XML data parts (data-bound content controls) — free-form XML. */
const CUSTOM_XML_RE = /^customXml\/item\d+\.xml$/;
/** Alternative-format chunks (HTML/RTF/MHT/plain text) embedded via altChunk. */
const ALT_CHUNK_RE = /^word\/[^/]+\.(html?|mht|mhtml|rtf|txt)$/i;
const RELS_PART_RE = /^word\/(_rels\/[^/]+\.rels|glossary\/_rels\/[^/]+\.rels)$/;
const MEDIA_RE = /^word\/media\/[^/]+$/;
const EMBEDDING_RE = /^word\/(embeddings|activeX)\//;
/** Attributes that carry user-visible text: field instructions, tooltips, image alt text. */
const TEXT_ATTR_RE = /\s(w:instr|w:tooltip|descr|title)="([^"]*)"/g;
/** Any text-bearing element opening tag — used to detect nodes our parser could not read. */
const TEXT_TAG_RE = /<(?:w:t|w:delText|w:instrText|a:t|m:t)[\s>]/g;

/**
 * Text node kinds. Each kind forms its own text stream so deleted
 * (tracked-change) text and field instructions don't merge with body text.
 */
const STREAMS = [
  { tag: "w:t", re: /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g },
  { tag: "w:delText", re: /<w:delText(\s[^>]*)?>([^<]*)<\/w:delText>/g },
  { tag: "w:instrText", re: /<w:instrText(\s[^>]*)?>([^<]*)<\/w:instrText>/g },
  { tag: "a:t", re: /<a:t(\s[^>]*)?>([^<]*)<\/a:t>/g },
  { tag: "m:t", re: /<m:t(\s[^>]*)?>([^<]*)<\/m:t>/g },
] as const;

/** Structure markers translated to whitespace in the main text stream. */
const BREAK_RE = /<\/w:p>|<w:(?:tab|br|cr)\b[^>]*\/>/g;

interface TextNode {
  /** Offset of the whole element in the XML. */
  xmlStart: number;
  xmlEnd: number;
  attrs: string;
  /** Character range within the stream text. */
  start: number;
  end: number;
}

/**
 * DOCX pipeline. Text is extracted from body, headers, footers, footnotes,
 * endnotes, comments, tracked deletions and field codes, protected as one
 * stream per part, and written back into the original runs so paragraphs,
 * headings, tables, lists and formatting are preserved. Hyperlink targets,
 * author attributes and document properties are sanitized as well.
 */
export async function processDocxInput(
  ctx: ProtectionContext,
  buffer: Buffer,
  mode: DocumentMode,
  options: DocxOptions,
): Promise<DocumentSafeData | null> {
  const entries = safeUnzip(buffer, ctx.limits);
  const byName = new Map(entries.map((e) => [e.name, e]));
  validateDocxStructure(byName);

  const texts: string[] = [];
  const output: ZipEntry[] = [];
  let metadataScrubbed = false;
  let mediaUninspected = 0;

  for (const entry of entries) {
    ctx.deadline.check();
    const { name } = entry;
    if (TEXT_PART_RE.test(name)) {
      const xml = strFromU8(entry.data);
      const { xml: safeXml, text } = await protectWordXml(ctx, xml);
      if (name === "word/document.xml") texts.unshift(text);
      else if (text.trim()) texts.push(text);
      const scrubbed = scrubAuthors(safeXml);
      if (scrubbed !== safeXml) metadataScrubbed = true;
      output.push({ name, data: strToU8(scrubbed) });
    } else if (RELS_PART_RE.test(name)) {
      output.push({ name, data: strToU8(await protectRelationships(ctx, strFromU8(entry.data))) });
    } else if (
      name === "docProps/core.xml" ||
      name === "docProps/app.xml" ||
      name === "docProps/custom.xml"
    ) {
      output.push({ name, data: strToU8(scrubProperties(strFromU8(entry.data))) });
      metadataScrubbed = true;
    } else if (/^word\/people\.xml$/.test(name)) {
      output.push({ name, data: strToU8(scrubAuthors(strFromU8(entry.data))) });
      metadataScrubbed = true;
    } else if (MEDIA_RE.test(name)) {
      const processed =
        options.inspectImages === false ? undefined : await protectMedia(ctx, entry);
      if (processed) output.push(processed);
      else {
        mediaUninspected++;
        output.push(entry);
      }
    } else if (CUSTOM_XML_RE.test(name)) {
      output.push({ name, data: strToU8(await protectGenericXml(ctx, strFromU8(entry.data))) });
    } else if (EMBEDDING_RE.test(name) || ALT_CHUNK_RE.test(name)) {
      mediaUninspected++;
      output.push(entry);
    } else {
      output.push(entry);
    }
  }

  if (mediaUninspected > 0) {
    ctx.warn({
      code: "EMBEDDED_MEDIA_NOT_INSPECTED",
      message: `${mediaUninspected} embedded image(s)/object(s) could not be inspected for sensitive content.`,
      severity: "error",
      incomplete: true,
    });
  }
  if (metadataScrubbed && ctx.mode === "protect" && mode === "document") {
    ctx.warn({
      code: "METADATA_REMOVED",
      message: "Document properties and author attributes were removed.",
      severity: "info",
    });
  }
  if (ctx.mode === "scan") return null;

  const result: DocumentSafeData = {
    text: texts
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
  if (mode === "document") {
    result.document = buildZip(output);
    result.mimeType = DOCX_MIME;
  }
  return result;
}

function validateDocxStructure(byName: Map<string, ZipEntry>): void {
  const contentTypes = byName.get("[Content_Types].xml");
  if (!contentTypes || !byName.has("word/document.xml")) {
    throw new UnsupportedFormatError("Archive is not a Word (.docx) document.");
  }
  const ct = strFromU8(contentTypes.data);
  if (/macroEnabled/i.test(ct) || byName.has("word/vbaProject.bin")) {
    throw new UnsupportedFormatError("Macro-enabled Word documents (.docm) are not supported.");
  }
  if (!/wordprocessingml\.(document|template)\.main\+xml/.test(ct)) {
    throw new UnsupportedFormatError("Archive is not a Word (.docx) document.");
  }
  // Reject DTDs / external entities outright; WordprocessingML never needs them.
  if (/<!DOCTYPE|<!ENTITY/i.test(strFromU8(byName.get("word/document.xml")!.data).slice(0, 4096))) {
    throw new DocumentProcessingError("Document contains a DTD declaration, which is not allowed.");
  }
}

/** Protect all text streams in a WordprocessingML part. Returns new XML and sanitized main text. */
export async function protectWordXml(
  ctx: ProtectionContext,
  xml: string,
): Promise<{ xml: string; text: string }> {
  const edits: { start: number; end: number; replacement: string }[] = [];
  let mainText = "";

  // Text hidden in CDATA sections or split by comments/processing instructions
  // would be rendered by Word but not seen by our text-node parser.
  const parsedNodes = STREAMS.reduce((n, st) => n + (xml.match(st.re)?.length ?? 0), 0);
  const textTags = xml.match(TEXT_TAG_RE)?.length ?? 0;
  if (/<!\[CDATA\[/.test(xml) || parsedNodes !== textTags) {
    ctx.warn({
      code: "DOCUMENT_STRUCTURE_UNSUPPORTED",
      message:
        "Document contains text in an unsupported XML form (CDATA or nested markup) that could not be inspected.",
      severity: "error",
      incomplete: true,
    });
  }

  // Text carried in attributes (field codes, tooltips, alt text).
  TEXT_ATTR_RE.lastIndex = 0;
  let attr: RegExpExecArray | null;
  while ((attr = TEXT_ATTR_RE.exec(xml)) !== null) {
    const decoded = decodeXml(attr[2] ?? "");
    if (decoded.trim().length === 0) continue;
    const seg = await ctx.processText(decoded);
    if (seg.text === decoded) continue;
    edits.push({
      start: attr.index,
      end: attr.index + attr[0].length,
      replacement: ` ${attr[1]}="${encodeXmlAttr(seg.text)}"`,
    });
  }

  for (const [index, stream] of STREAMS.entries()) {
    const nodes: TextNode[] = [];
    let text = "";
    const isMain = index === 0;

    // Merge text nodes and (for the main stream) structural breaks in document order.
    const events: { pos: number; kind: "node" | "break"; m: RegExpExecArray }[] = [];
    stream.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = stream.re.exec(xml)) !== null) events.push({ pos: m.index, kind: "node", m });
    if (isMain) {
      BREAK_RE.lastIndex = 0;
      while ((m = BREAK_RE.exec(xml)) !== null) events.push({ pos: m.index, kind: "break", m });
    } else {
      // Separate unrelated deleted runs / field codes by paragraph.
      BREAK_RE.lastIndex = 0;
      while ((m = BREAK_RE.exec(xml)) !== null)
        if (m[0] === "</w:p>") events.push({ pos: m.index, kind: "break", m });
    }
    if (!events.some((e) => e.kind === "node")) continue;
    events.sort((a, b) => a.pos - b.pos);

    for (const ev of events) {
      if (ev.kind === "break") {
        const tag = ev.m[0];
        text += tag.startsWith("<w:tab") ? "\t" : "\n";
        continue;
      }
      const value = decodeXml(ev.m[2] ?? "");
      const start = text.length;
      text += value;
      nodes.push({
        xmlStart: ev.m.index,
        xmlEnd: ev.m.index + ev.m[0].length,
        attrs: ev.m[1] ?? "",
        start,
        end: text.length,
      });
    }

    const seg = await ctx.processText(text);
    if (isMain) mainText = seg.text;
    if (seg.replacements.length === 0) continue;

    // Each replacement is written into the first text node it overlaps; the
    // remaining covered characters are removed from subsequent nodes.
    const emitted = new Set<number>();
    const sorted = [...seg.replacements].sort((a, b) => a.start - b.start);
    // Nodes and replacements are both ordered by offset: sweep them together.
    let first = 0;
    for (const node of nodes) {
      while (first < sorted.length && sorted[first]!.end <= node.start) first++;
      let out = "";
      let pos = node.start;
      let touched = false;
      for (let i = first; i < sorted.length && sorted[i]!.start < node.end; i++) {
        const r = sorted[i]!;
        touched = true;
        if (r.start > pos) out += text.slice(pos, r.start);
        if (!emitted.has(i)) {
          out += r.replacement;
          emitted.add(i);
        }
        pos = Math.max(pos, Math.min(r.end, node.end));
      }
      if (!touched) continue;
      if (pos < node.end) out += text.slice(pos, node.end);
      edits.push({
        start: node.xmlStart,
        end: node.xmlEnd,
        replacement: `<${stream.tag} xml:space="preserve">${encodeXmlText(out)}</${stream.tag}>`,
      });
    }
  }

  if (edits.length === 0) return { xml, text: mainText };
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    if (e.start < cursor) continue; // never apply overlapping edits
    out += xml.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  return { xml: out + xml.slice(cursor), text: mainText };
}

/** Protect every text node in free-form XML (custom XML data parts). */
async function protectGenericXml(ctx: ProtectionContext, xml: string): Promise<string> {
  const re = />([^<]+)</g;
  const parts: string[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1] ?? "";
    if (raw.trim().length === 0) continue;
    const decoded = decodeXml(raw);
    const seg = await ctx.processText(decoded);
    if (seg.text === decoded) continue;
    parts.push(xml.slice(cursor, m.index + 1), encodeXmlText(seg.text));
    cursor = m.index + 1 + raw.length;
  }
  parts.push(xml.slice(cursor));
  return parts.join("");
}

/** Sanitize external relationship targets (hyperlinks such as mailto: links). */
async function protectRelationships(ctx: ProtectionContext, xml: string): Promise<string> {
  const re = /<Relationship\b[^>]*>/g;
  const parts: string[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    if (!/TargetMode="External"/.test(tag)) continue;
    const target = /Target="([^"]*)"/.exec(tag);
    if (!target) continue;
    const decoded = decodeXml(target[1] ?? "");
    const seg = await ctx.processText(decoded);
    if (seg.text === decoded) continue;
    parts.push(
      xml.slice(cursor, m.index),
      tag.replace(target[0], `Target="${encodeXmlAttr(seg.text)}"`),
    );
    cursor = m.index + tag.length;
  }
  parts.push(xml.slice(cursor));
  return parts.join("");
}

/** Replace author/initials attributes (comments, tracked changes) with a neutral value. */
function scrubAuthors(xml: string): string {
  return xml
    .replace(/\bw:author="[^"]*"/g, 'w:author="ARAN"')
    .replace(/\bw:initials="[^"]*"/g, 'w:initials="A"')
    .replace(/\bw15:author="[^"]*"/g, 'w15:author="ARAN"')
    .replace(/\bw15:userId="[^"]*"/g, 'w15:userId="ARAN"')
    .replace(/\bw15:providerId="[^"]*"/g, 'w15:providerId="None"');
}

/** Clear document properties that commonly contain personal data. */
function scrubProperties(xml: string): string {
  const fields = [
    "dc:creator",
    "cp:lastModifiedBy",
    "dc:title",
    "dc:subject",
    "dc:description",
    "cp:keywords",
    "cp:category",
    "cp:contentStatus",
    "Company",
    "Manager",
    "HyperlinkBase",
    "Template",
  ];
  let out = xml;
  for (const f of fields) {
    const esc = f.replace(":", "\\:");
    out = out.replace(new RegExp(`<${esc}(\\s[^>]*)?>[\\s\\S]*?</${esc}>`, "g"), `<${f}$1></${f}>`);
  }
  // Custom properties: blank every value.
  out = out.replace(/(<vt:lpwstr>)[\s\S]*?(<\/vt:lpwstr>)/g, "$1$2");
  return out;
}

/** OCR and redact an embedded PNG/JPEG. Returns undefined if the media could not be inspected. */
async function protectMedia(
  ctx: ProtectionContext,
  entry: ZipEntry,
): Promise<ZipEntry | undefined> {
  const buffer = Buffer.from(entry.data);
  const format = sniffFormat(buffer);
  if (format !== "png" && format !== "jpeg") return undefined;
  if ((await ctx.services.ocr()) === undefined) return undefined;
  try {
    const image = await normalizeImage(ctx, buffer);
    const inspection = await inspectImage(ctx, image.png);
    if (!inspection.inspected) return undefined;
    if (ctx.mode === "scan") return entry;
    // Always re-encode so EXIF/GPS metadata is stripped even when nothing was redacted.
    const redacted = await drawRedactions(
      ctx,
      image.png,
      image.width,
      image.height,
      inspection.boxes,
      format === "jpeg" ? "jpeg" : "png",
    );
    return { name: entry.name, data: new Uint8Array(redacted) };
  } catch {
    return undefined;
  }
}
