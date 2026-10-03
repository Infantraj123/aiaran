# 6. Word documents (.docx)

Demo: [`demos/05-docx.ts`](../../demos/05-docx.ts)

```bash
node demos/05-docx.ts                # synthetic letter
node demos/05-docx.ts ./letter.docx  # your own document
```

DOCX support is **built in**; you don't need extra packages. To also clean **pictures inside** the document, install `sharp tesseract.js @tesseract.js-data/eng`.

- [6.1 Content mode vs document mode](#61-content-mode-vs-document-mode)
- [6.2 Step by step](#62-step-by-step)
- [6.3 What gets cleaned (including hidden places)](#63-what-gets-cleaned-including-hidden-places)
- [6.4 Layout is preserved](#64-layout-is-preserved)
- [6.5 Pictures inside the document](#65-pictures-inside-the-document)
- [6.6 What ARAN does not handle, and how it tells you](#66-what-aran-does-not-handle-and-how-it-tells-you)
- [6.7 Legacy .doc files](#67-legacy-doc-files)
- [6.8 Options and limits](#68-options-and-limits)

---

## 6.1 Content mode vs document mode

| Mode                  | You get                                                          | Use for                                  |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| `"content"` (default) | `safeData.text`: sanitized plain text of the whole document      | sending the content to an AI             |
| `"document"`          | `safeData.text` **and** `safeData.document`: a sanitized `.docx` | storing, sharing or emailing a safe copy |

## 6.2 Step by step

### Step 1: read the file

```ts
import { readFile, writeFile } from "node:fs/promises";
import { Aran } from "aiaran";

const aran = new Aran({ policy: "healthcare" });
const data = await readFile("letter.docx");
```

### Step 2: content mode (text for the AI)

```ts
const content = await aran.protect({ type: "docx", data });
console.log(content.status);
console.log(content.safeData?.text);
```

```text
status: safe
Appointment letter
Dear [PERSON_001],
Your patient ID is [PATIENT_ID_001]. We will call you on [PHONE_REDACTED].
Field
Value
Email
[EMAIL_REDACTED]
PAN
[PAN_REDACTED]
Email us

Blood pressure 150/95. Please bring your previous reports.

Confidential — [PERSON_001]
```

The text includes the body, table cells (one per line), and headers and footers (at the end).

### Step 3: document mode (a safe .docx)

```ts
const result = await aran.protect({
  type: "docx",
  data,
  mode: "document",
  filename: "letter.docx",
});

if (result.status === "safe" && result.safeData?.document) {
  await writeFile("letter.sanitized.docx", result.safeData.document);
}
```

```text
status: safe
ID    TYPE                    CONF   WHERE              ACTION        REPLACEMENT
E1    PERSON                  0.85   chars 24-34        tokenize      [PERSON_001]
E2    PATIENT_ID              0.85   chars 55-62        tokenize      [PATIENT_ID_001]
E3    PHONE                   0.90   chars 84-99        redact        [PHONE_REDACTED]
E4    EMAIL                   0.95   chars 119-141      redact        [EMAIL_REDACTED]
E5    PAN                     0.95   chars 146-156      redact        [PAN_REDACTED]
E6    PHONE                   0.90   chars 20-31        redact        [PHONE_REDACTED]
E7    EMAIL                   0.95   chars 7-29         redact        [EMAIL_REDACTED]
E8    PERSON                  0.75   chars 15-25        tokenize      [PERSON_001]
Warnings:
  [info] METADATA_REMOVED: Document properties and author attributes were removed.
```

Entities E6–E8 come from _other parts_ of the file: the tracked deletion, the hyperlink and the page header. Their offsets are relative to that part's text.

Open `letter.sanitized.docx` in Word, LibreOffice or Google Docs. It looks like the original, with placeholders where the sensitive values were.

## 6.3 What gets cleaned (including hidden places)

Word files keep text in many places you can't see on the page. ARAN cleans them all. Here is the demo's check of the sanitized file:

```text
hyperlink target : mailto:[EMAIL_REDACTED]
tracked deletion : Old phone [PHONE_REDACTED]
revision author  : ARAN
header           : Confidential — [PERSON_001]
doc creator      : ""
'Ravi' anywhere in the file? no
```

| Location                                                                                               | Cleaned how                                         |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Body paragraphs, headings, lists, tables, text boxes                                                   | text replaced inside the original runs              |
| Headers and footers                                                                                    | same                                                |
| Footnotes and endnotes                                                                                 | same                                                |
| Comments                                                                                               | text cleaned; author names replaced with `ARAN`     |
| Tracked changes: deleted text                                                                          | cleaned (deleted text is still stored in the file!) |
| Tracked changes: author names                                                                          | replaced with `ARAN`                                |
| Field codes (e.g. `HYPERLINK "mailto:…"`)                                                              | cleaned                                             |
| Hyperlink targets (`mailto:`, URLs with personal data)                                                 | cleaned                                             |
| Image alt text and titles                                                                              | cleaned                                             |
| Charts and SmartArt text                                                                               | cleaned                                             |
| Equations (math text)                                                                                  | cleaned                                             |
| Custom XML data (content controls bound to data)                                                       | cleaned                                             |
| Document properties: author, last modified by, title, subject, keywords, description, company, manager | emptied (`METADATA_REMOVED`)                        |
| Embedded PNG/JPEG pictures                                                                             | OCR'd and redacted (6.5)                            |

## 6.4 Layout is preserved

ARAN changes only the text inside existing text elements. Styles, fonts, colours, paragraphs, tables, numbering, page setup, images and sections are untouched.

Word often splits one word across several "runs" (for example after spell-check). ARAN joins them for detection and writes the replacement into the first run:

```text
original runs : "Dear " | "Ravi " | "Ku" | "mar" | ","
after         : "Dear " | "[PERSON_001]" | "" | "" | ","
```

## 6.5 Pictures inside the document

With `sharp` and OCR installed, each embedded PNG or JPEG is OCR'd, redacted, and saved back in its original format, with EXIF/GPS removed:

```bash
npm install sharp tesseract.js @tesseract.js-data/eng
```

```ts
const r = await aran.protect({ type: "docx", data, mode: "document" });
// an email shown inside a pasted screenshot becomes a black box in the picture
```

To skip picture inspection (faster, but the result becomes `uncertain`):

```ts
new Aran({ docx: { inspectImages: false } });
```

## 6.6 What ARAN does not handle, and how it tells you

ARAN never silently skips content. Anything it cannot inspect produces a warning and `status: "uncertain"`. Under a fail-closed policy, `safeData` is then `null`.

| Content                                                  | Result                                                   |
| -------------------------------------------------------- | -------------------------------------------------------- |
| Pictures without OCR installed, or EMF/WMF/SVG pictures  | `EMBEDDED_MEDIA_NOT_INSPECTED` → uncertain               |
| Embedded objects (Excel sheets, OLE, ActiveX)            | `EMBEDDED_MEDIA_NOT_INSPECTED` → uncertain               |
| altChunk content (embedded HTML/RTF/MHT)                 | `EMBEDDED_MEDIA_NOT_INSPECTED` → uncertain               |
| Text hidden in unusual XML (CDATA, comments inside text) | `DOCUMENT_STRUCTURE_UNSUPPORTED` → uncertain             |
| Macro-enabled documents (`.docm`)                        | rejected: `UnsupportedFormatError`                       |
| Documents with a DTD (`<!DOCTYPE`)                       | rejected: `DocumentProcessingError` (blocks XXE attacks) |
| Zip bombs, too many files, unsafe paths inside the zip   | rejected: `SecurityError`                                |

If you must accept such documents under a fail-closed policy, remove the embedded objects first (in Word: right-click → Delete, or Save As → strict Open XML), then protect the document again.

## 6.7 Legacy .doc files

Old binary `.doc` files (Word 97–2003) are **not supported**. ARAN recognises them and says so:

```text
UnsupportedFormatError: Legacy binary .doc files are not supported. Convert the document to .docx first.
```

Convert them first, for example with LibreOffice (offline):

```bash
soffice --headless --convert-to docx old-letter.doc
```

## 6.8 Options and limits

|                                        | Default                                     | Option                        |
| -------------------------------------- | ------------------------------------------- | ----------------------------- |
| Inspect embedded pictures              | `true`                                      | `docx.inspectImages`          |
| Max file size                          | 50 MB                                       | `limits.maxFileBytes`         |
| Max total unzipped size                | 200 MB                                      | `limits.maxUncompressedBytes` |
| Max files inside the .docx             | 2,000                                       | `limits.maxZipEntries`        |
| Max compression ratio (zip-bomb guard) | 200×                                        | `limits.maxCompressionRatio`  |
| Speed                                  | ~0.2 s for 5,000 paragraphs (document mode) |                               |

---

← [5. PDF](05-pdf.md) · Next: [7. Policies and minimization →](07-policies-and-minimization.md)
