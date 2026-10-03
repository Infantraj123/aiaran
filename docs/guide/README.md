# ARAN User Guide

This guide explains, step by step, how to use ARAN to protect **text, JSON, images, PDFs and Word documents** before they reach an AI model, and how to restore the AI's answer afterwards.

Every chapter has a matching **runnable demo** in [`demos/`](../../demos). The outputs shown in this guide were captured by running those demos, so what you see is what you will get.

## Learning path

| #   | Chapter                                                      | You will learn                                                                                             | Demo                                             |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | [Installation and setup](01-installation-and-setup.md)       | Install ARAN and only the features you need, set up OCR languages, check everything with `aran doctor`     | `npx aran doctor`                                |
| 2   | [Core concepts](02-core-concepts.md)                         | The protect → AI → release flow, sessions, tokens vs redaction, result fields, statuses, fail-open/closed  | –                                                |
| 3   | [Text and JSON](03-text-and-json.md)                         | Strings, objects, chat conversations, restoring answers, scanning, multilingual text                       | `01-text.ts`, `02-json.ts`, `09-multilingual.ts` |
| 4   | [Images](04-images.md)                                       | Screenshots, photos and scans: OCR, redacted images, bounding boxes                                        | `03-image.ts`                                    |
| 5   | [PDF](05-pdf.md)                                             | Text PDFs, scanned PDFs, content mode vs document mode                                                     | `04-pdf.ts`                                      |
| 6   | [Word (.docx)](06-word-docx.md)                              | Sanitized text and sanitized `.docx` that keeps its layout                                                 | `05-docx.ts`                                     |
| 7   | [Policies and minimization](07-policies-and-minimization.md) | Built-in policies, YAML policies, purposes, custom entity types                                            | `06-policies.ts`                                 |
| 8   | [AI providers](08-ai-providers.md)                           | OpenAI, Anthropic, Gemini, Ollama, any compatible server, your own client, web APIs                        | `07-ai-providers.ts`, `10-web-server.ts`         |
| 9   | [Command-line tool](09-cli.md)                               | `aran scan`, `aran protect`, `aran policy validate`, `aran doctor`                                         | `11-cli.sh`                                      |
| 10  | [Production and security](10-production-and-security.md)     | Encrypted/external mapping stores, retention, logging, audit, limits, error handling, deployment checklist | `08-production.ts`                               |
| 11  | [Troubleshooting and FAQ](11-troubleshooting-and-faq.md)     | Every warning and error explained, with fixes                                                              | –                                                |

**In a hurry?** Read chapter 1, then the chapter for your file type, then chapter 8.

## Running the demos

```bash
git clone https://github.com/Infantraj123/aiaran.git && cd aiaran
npm install
npm run build              # demos import the built package
node demos/01-text.ts      # Node.js 22.18+ runs TypeScript directly
# Node 20: npx tsx demos/01-text.ts
```

The demos create their own **synthetic** sample files in `demos/output/` (fake names, fake numbers). Most of them also accept your own file:

```bash
node demos/03-image.ts ./my-screenshot.png
node demos/04-pdf.ts ./my-report.pdf
node demos/05-docx.ts ./my-letter.docx
```

Run them all with `npm run demos`.

## Glossary

| Term                 | Meaning                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Entity**           | One detected sensitive value, such as a phone number. ARAN reports its _type_, _position_ and _confidence_, never the value itself. |
| **Entity type**      | The category, e.g. `PERSON`, `EMAIL`, `AADHAAR`, `API_KEY`. See [docs/detection.md](../detection.md).                               |
| **Policy**           | Rules that decide what happens to each entity type.                                                                                 |
| **Action**           | What a policy does to an entity: `allow`, `redact`, `tokenize`, `pseudonymize` or `block`.                                          |
| **Token**            | A reversible placeholder such as `[PERSON_001]`. It contains no part of the original value.                                         |
| **Redaction marker** | A non-reversible placeholder such as `[EMAIL_REDACTED]`.                                                                            |
| **Session**          | A container for one conversation's token mappings, identified by `sessionId`.                                                       |
| **safeData**         | The protected payload. It is the only thing you should send to an AI.                                                               |
| **Release**          | Scanning the AI's answer and restoring tokens back to the original values.                                                          |
| **Fail-closed**      | When something can't be fully inspected, ARAN returns no data instead of possibly unsafe data.                                      |
| **Purpose**          | A short description of why you are calling the AI. Policies can use it to remove more data.                                         |
