# Examples

All examples use synthetic data. Build the package first; the examples import `aiaran` via package self-reference.

```bash
npm run build
node scripts/generate-fixtures.mjs        # sample files in test-fixtures/
node examples/basic-text.ts               # Node ≥ 22.18 runs TypeScript directly
# on Node 20: npx tsx examples/basic-text.ts
```

| File                          | Shows                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| `basic-text.ts`               | Minimal text protection and restoration                                 |
| `healthcare-purpose.ts`       | Healthcare policy, purpose-based minimization, decision report          |
| `structured-json.ts`          | Protecting JSON objects, field-name hints                               |
| `image.ts`                    | Screenshot OCR and redaction                                            |
| `pdf.ts`                      | PDF content mode and document mode                                      |
| `docx.ts`                     | DOCX sanitization preserving structure                                  |
| `custom-policy-and-entity.ts` | YAML policy, custom entity type, audit events                           |
| `encrypted-store.ts`          | Encrypted mapping store and zero retention                              |
| `ai-openai.ts`                | `generate()` with OpenAI (needs `OPENAI_API_KEY`)                       |
| `ai-anthropic.ts`             | `generate()` with Anthropic (needs `@anthropic-ai/sdk` and credentials) |
| `ai-ollama-local.ts`          | Fully local pipeline with Ollama                                        |
| `docker/`                     | Offline CLI container                                                   |
