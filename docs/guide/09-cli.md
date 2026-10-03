# 9. The `aran` command-line tool

Demo: [`demos/11-cli.sh`](../../demos/11-cli.sh)

```bash
bash demos/11-cli.sh        # from the repository root, after npm run build
```

The CLI is installed with the package. Run it with `npx aran …` inside your project, or install it globally with `npm install -g aiaran` and run `aran …`.

The CLI **never prints sensitive values**: only types, counts and risk levels.

- [9.1 Commands at a glance](#91-commands-at-a-glance)
- [9.2 `aran doctor`](#92-aran-doctor)
- [9.3 `aran scan`](#93-aran-scan)
- [9.4 `aran protect`](#94-aran-protect)
- [9.5 `aran policy validate`](#95-aran-policy-validate)
- [9.6 Lists](#96-lists)
- [9.7 Exit codes and scripting](#97-exit-codes-and-scripting)
- [9.8 Recipes](#98-recipes)

---

## 9.1 Commands at a glance

```text
$ npx aran --help
ARAN 0.1.0 — local-first AI privacy scanner

Usage:
  aran scan <file|->        [--type T] [--policy P] [--json]
  aran protect <file|->     [--out PATH] [--mode content|document] [--policy P] [--force] [--json]
  aran policy validate <policy.yaml|json>
  aran policies list
  aran entities list
  aran providers list
  aran doctor               [--ocr-lang eng,hin] [--ocr-path DIR]   check which features work

Options:
  --type      text | image | pdf | docx (default: detected from content/extension)
  --policy    built-in policy name or path to a .yaml/.json policy (default: default)
  --mode      content (sanitized text) or document (sanitized file) for PDF/DOCX
  --out       output path (default: <name>.protected.<ext> next to the input)
  --force     overwrite an existing output file
  --json      machine-readable output (never contains sensitive values)
  --ocr-lang  OCR languages, comma-separated (default: eng)
  --ocr-path  folder with <lang>.traineddata(.gz) files (needed for several languages)

Sensitive values are never printed. Token mappings are not written by the CLI,
so tokens in protected files cannot be restored.
```

**File type detection:** a known extension decides first (`.txt .md .json .csv .log .js .ts .py .sql …` → text, `.png .jpg .webp .tif` → image, `.pdf`, `.docx`). Otherwise the content's magic bytes decide, and anything else is treated as text. Use `--type` to force a type. File content is always checked against the type, so a fake `.pdf` is rejected. Use `-` to read from stdin.

## 9.2 `aran doctor`

Checks which features work on this machine. See [chapter 1.4](01-installation-and-setup.md#14-check-your-setup-with-aran-doctor).

```text
$ npx aran doctor
ARAN 0.1.0 — environment check

✓ Node.js                                      v24.14.1
✓ Text protection                              built in
✓ Images (sharp)                               sharp 0.35.5
✓ OCR (tesseract.js)                           tesseract.js 7.0.0, languages: eng (local data)
✓ PDF (pdfjs-dist)                             pdfjs-dist 6.3.289
✓ PDF rendering (scanned PDFs, document mode)  page rendering works
✓ PDF document mode (pdf-lib)                  pdf-lib 1.17.1
✓ DOCX                                         built in (embedded images need sharp + OCR)
✓ Anthropic provider                           @anthropic-ai/sdk 0.131.0
✓ OpenAI / Gemini / Ollama providers           built in (fetch)
```

```bash
npx aran doctor --ocr-lang eng,hin,tam --ocr-path ./tessdata
npx aran doctor --json
```

## 9.3 `aran scan`

Shows what's inside a file without changing it:

```text
$ npx aran scan note.txt
ARAN Privacy Scanner

PERSON                  1
PATIENT_ID              1
AGE                     1
EMAIL                   1
PHONE                   1

Risk level: HIGH

No sensitive values displayed.
```

Works for every type:

```bash
npx aran scan report.pdf
npx aran scan screenshot.png
npx aran scan letter.docx
cat app.log | npx aran scan -
npx aran scan scan-in-hindi.png --ocr-lang hin
```

JSON output, for scripts and CI:

```bash
npx aran scan note.txt --json
```

```json
{
  "type": "text",
  "status": "complete",
  "summary": {
    "total": 5,
    "counts": { "PERSON": 1, "PATIENT_ID": 1, "AGE": 1, "EMAIL": 1, "PHONE": 1 },
    "riskLevel": "HIGH"
  },
  "warnings": [],
  "metadata": {
    "processingTimeMs": 32,
    "detectorVersions": {
      "aran.pii": "1.0.0",
      "aran.secrets": "1.0.0",
      "aran.ner-heuristic": "1.0.0"
    }
  }
}
```

`status` is `"incomplete"` when something couldn't be inspected (for example, OCR is missing for a scanned PDF). The human-readable output then also says `Scan incomplete`.

## 9.4 `aran protect`

Writes a protected copy:

```text
$ npx aran protect note.txt --policy healthcare --out note.safe.txt
ARAN Privacy Protection

PERSON                  1
PATIENT_ID              1
AGE                     1
EMAIL                   1
PHONE                   1

Risk level: HIGH

Status: SAFE
Written: note.safe.txt
No sensitive values displayed.

$ cat note.safe.txt
Patient [PERSON_001] (patient ID [PATIENT_ID_001]), age 52.
Email [EMAIL_REDACTED], phone [PHONE_REDACTED].
```

What gets written:

| Input | `--mode content` (default)              | `--mode document`                      |
| ----- | --------------------------------------- | -------------------------------------- |
| text  | `<name>.protected.txt`                  | –                                      |
| image | `<name>.protected.png` (redacted image) | –                                      |
| PDF   | `<name>.protected.txt` (sanitized text) | `<name>.protected.pdf` (sanitized PDF) |
| DOCX  | `<name>.protected.txt`                  | `<name>.protected.docx`                |

```bash
npx aran protect report.pdf --mode document                  # → report.protected.pdf
npx aran protect letter.docx --mode document --policy healthcare
npx aran protect screenshot.png --out safe.png
npx aran protect notes.txt --policy ./policies/clinic.yaml
npx aran protect notes.txt --json                            # summary + minimization as JSON
```

Safety rules:

- The CLI refuses to overwrite an existing file unless you pass `--force`, and it never overwrites the input file.
- Output files are created with permissions `0600` (readable only by you).
- Token mappings are **not** saved, so tokens in CLI output cannot be restored later. Use the SDK if you need restoration.
- If the result is `blocked`, or withheld (fail-closed), **no file is written**.

## 9.5 `aran policy validate`

```text
$ npx aran policy validate policy.yaml
Policy "demo" is valid.

$ npx aran policy validate bad.yaml
ERROR    entities.PERSON: Invalid action "explode".
ERROR    entities.__proto__: Entity type names must be UPPER_SNAKE_CASE.
Policy is invalid (2 error(s)).
```

Unknown entity types produce a `WARNING` (they might be custom types you register in code).

## 9.6 Lists

```text
$ npx aran policies list
default      fail-open    Balanced protection: tokenize personal identifiers, redact secrets and card numbers.
strict       fail-closed  Fail-closed. Lower detection threshold; block secrets and payment data; redact identifiers.
healthcare   fail-closed  Clinical data: keep clinical context, tokenize patient identity, block payment data and secrets.
financial    fail-closed  Financial services: block card numbers and secrets, tokenize account identifiers.
developer    fail-open    Source code and logs: redact credentials, tokenize personal data, keep URLs and IPs as tokens.
enterprise   fail-closed  Corporate data: fail-closed, block secrets, hide internal infrastructure, tokenize people.

$ npx aran providers list
openai             OpenAIProvider             none (fetch)                         OpenAI Chat Completions API
openai-compatible  OpenAICompatibleProvider   none (fetch)                         Any OpenAI-compatible server (vLLM, LM Studio, LiteLLM, Azure-compatible gateways)
anthropic          AnthropicProvider          @anthropic-ai/sdk (optional peer)    Anthropic Messages API
gemini             GeminiProvider             none (fetch)                         Google Gemini generateContent API
ollama             OllamaProvider             none (fetch)                         Local Ollama server
custom             createProvider()           none                                 Wrap your own function

$ npx aran entities list
PERSON                   identity     Person name
EMAIL                    identity     Email address
PHONE                    identity     Phone number
…
```

All lists support `--json`.

## 9.7 Exit codes and scripting

| Exit code | Meaning                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| `0`       | success (for `scan`, even when sensitive data was found; read the output or `--json`) |
| `1`       | error (bad arguments, missing file, unsupported file, missing optional package)       |
| `2`       | `policy validate`: the policy is invalid                                              |
| `3`       | `protect`: blocked by policy, nothing written                                         |
| `4`       | `protect`: content couldn't be fully inspected (fail-closed), nothing written         |

Error messages go to stderr, prefixed with `aran:`, and never contain file contents.

## 9.8 Recipes

**Fail a CI build when a commit adds secrets to docs or config:**

```bash
for f in $(git diff --name-only origin/main -- '*.md' '*.yaml' '*.json'); do
  risk=$(npx aran scan "$f" --json | node -pe 'JSON.parse(require("fs").readFileSync(0)).summary.riskLevel')
  if [ "$risk" = "CRITICAL" ]; then echo "Secret found in $f"; exit 1; fi
done
```

**Sanitize a folder of PDFs before sharing:**

```bash
mkdir -p safe
for f in reports/*.pdf; do
  npx aran protect "$f" --mode document --policy healthcare --out "safe/$(basename "$f")" \
    || echo "NOT sanitized: $f (exit $?)"
done
```

**Check log files before sending them to support:**

```bash
npx aran protect app.log --policy developer --out app.safe.log
```

**Offline in Docker:**

```bash
docker run --rm --network none -v "$PWD:/data" aran scan /data/report.pdf
```

---

← [8. AI providers](08-ai-providers.md) · Next: [10. Production and security →](10-production-and-security.md)
