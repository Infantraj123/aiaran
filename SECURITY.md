# Security Policy

## Reporting a vulnerability

**Please do not open public issues for security vulnerabilities.**

Report vulnerabilities privately via GitHub Security Advisories ("Report a vulnerability" on the repository's Security tab), or by email to **infantraj01012003@gmail.com**.

Please include:

- a description of the issue and its impact
- steps to reproduce, using **synthetic data only**. Never send real personal data, real credentials or real documents.
- affected versions and environment

We aim to acknowledge reports within 3 business days and to provide a remediation plan within 14 days. We will credit reporters who wish to be credited once a fix is released.

## Supported versions

| Version            | Supported |
| ------------------ | --------- |
| 0.x (latest minor) | ✅        |
| older              | ❌        |

## Scope

In scope:

- sensitive values leaking through ARAN outputs, metadata, logs, audit events or errors
- bypasses of document sanitization (text recoverable from "sanitized" PDFs or DOCX files)
- cross-session token restoration
- weaknesses in mapping encryption
- denial of service through crafted inputs (zip bombs, decompression, ReDoS, unbounded memory)
- unsafe parsing (XXE, prototype pollution, path traversal)

Out of scope:

- detection misses for unstructured personal data without cues. These are known limitations; please open a normal issue with a synthetic example.
- vulnerabilities in optional peer dependencies (report them upstream; we will update our ranges)
- issues requiring a compromised host or application process

## Security design summary

- **Local processing.** Detection, OCR, rendering and redaction run in-process. ARAN makes no network requests except through provider adapters you call explicitly. OCR language data is loaded locally by default.
- **Value-free reporting.** Results, logs, audit events and errors never include original values. Tokens carry only an entity type and a counter.
- **Mappings.** Stored in memory by default, scoped to a random 128-bit session ID, TTL-bound (default 1 hour), destroyable on demand, or destroyed immediately with `retention: "zero"`. Optional AES-256-GCM encryption uses a random 96-bit IV and binds the storage key, entity type and restore flag as AAD. Session reverse indexes use HMAC-SHA-256 under a per-session random key.
- **Cryptography.** Node.js `crypto` only (AES-256-GCM, SHA-256, HMAC-SHA-256, scrypt). No custom algorithms. Plain hashes are never used for reversible protection.
- **Input validation.** Magic-byte sniffing; extensions and MIME types are cross-checked but never trusted. Limits cover file size, text size, PDF pages, image dimensions and pixels, ZIP entries, uncompressed size, compression ratio, object depth and node count, entity count, and per-request and OCR timeouts.
- **Parsers.** PDF.js runs with `isEvalSupported: false`, font loading disabled and XFA disabled. DOCX parsing is text-node based; DTDs, macro-enabled documents and unsafe ZIP paths are rejected. YAML uses the core schema with an alias limit. Prototype-polluting keys are dropped or rejected.
- **No temporary files.** All processing happens in memory. The CLI writes only the output file you request, with mode `0600`.
- **Fail-closed.** When inspection is incomplete, fail-closed policies withhold data instead of returning partially inspected content.

See [docs/threat-model.md](docs/threat-model.md) for the full threat model.

## Known advisories in optional dependencies

**pdfjs-dist (GHSA-hq66-cqwq-w95j, fixed in 6.2.108).** The advisory concerns attacker-controlled JavaScript running when the PDF.js _viewer_ is used with `enableScripting` in a browser. ARAN uses only the PDF.js core API in Node.js (`getDocument`). It never loads the viewer or the scripting sandbox, disables `eval`-based font compilation, and disables XFA, so the vulnerable code path is not reached. Even so:

- the supported peer range excludes the affected 6.x releases (`^5.6.205 || >=6.2.108`)
- **on Node.js 22.13+ use pdfjs-dist ≥ 6.2.108** (the version ARAN is developed and tested with)
- pdfjs-dist 6 does not support Node.js 20, so Node 20 users can only use the 5.6 line. `npm audit` will report the advisory there. If that is not acceptable, process PDFs on Node 22+.

## Dependency hygiene

CI runs `npm audit --audit-level=high` on every pull request. Runtime dependencies are limited to `yaml` and `fflate`; everything else is an optional peer dependency that you install only if you need the feature.
