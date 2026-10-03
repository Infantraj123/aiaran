# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-03

### Added

- `Aran` SDK with `protect`, `scan`, `release`, `restore`, `generate`, `destroySession` and `dispose`.
- Text and structured JSON protection with field-name hints and prototype-pollution safe copying.
- Image protection: local OCR (tesseract.js), bounding-box redaction, EXIF/GPS stripping, optional face detector interface.
- PDF protection: text-layer extraction, OCR for scanned pages and embedded images, content and document modes, flattened sanitized PDF output, optional OCR verification of redactions.
- DOCX protection: run-preserving replacement across body, headers, footers, notes, comments, tracked changes, field codes, hyperlinks, alt text, charts/SmartArt and custom XML; metadata scrubbing; embedded image OCR.
- Detection of 36 built-in entity types across identity, government, financial, security, healthcare and network categories, with checksum validators and English/Hindi/Tamil context.
- Heuristic local NER for persons, addresses and healthcare providers; pluggable `NerDetector`.
- Policy engine with six built-in policies, YAML/JSON policies, inheritance, purpose-based minimization and explainable decisions.
- Reversible tokenization, pseudonymization, redaction and blocking; session-scoped mappings; memory, encrypted-memory and custom stores (AES-256-GCM).
- Output scanning with configurable actions for unexpected sensitive values.
- Provider adapters: OpenAI, OpenAI-compatible, Anthropic (official SDK, optional), Google Gemini, Ollama, custom.
- Fail-open / fail-closed modes, typed errors, allowlist logging, value-free audit events.
- File safety: magic-byte validation, size/page/pixel/decompression/ratio/entry/depth/time limits.
- SSRF helpers (`assertPublicUrl`, `classifyHost`) for future URL ingestion.
- `aran` CLI: `scan`, `protect`, `policy validate`, `policies list`, `entities list`, `providers list`.
- Documentation, threat model, Docker example, GitHub Actions CI and release workflows.
- `aran doctor` environment check and `--ocr-path` CLI option for multi-language OCR data.
- Step-by-step user guide (`docs/guide/`) and runnable demos (`demos/`) for every feature.
- Purpose matching: exact rule id first, then the most specific (longest) keyword.
- `release()` extends session lifetime (stored mapping expiries are refreshed).
- Detection of Indic-script names after English labels, and of names after a capitalised non-name word.
