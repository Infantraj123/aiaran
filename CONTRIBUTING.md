# Contributing to ARAN

Thank you for helping make AI usage safer. Please read this guide before opening a pull request.

## Ground rules

1. **Synthetic data only.** Never commit, paste or attach real personal data, real credentials or real documents. That applies to code, tests, fixtures, issues, PR descriptions and screenshots. Use the generators in `tests/helpers/synthetic.ts` and `scripts/fixtures.mjs`. Checksummed identifiers (Aadhaar, cards, IBAN) should be computed, not copied.
2. **No sensitive values in output.** New code must not put original values into results, warnings, errors, logs or audit events. Error messages describe the entity type, never the value ("Invalid EMAIL entity detected.", not the address).
3. **No silent failures.** If content cannot be inspected, emit a `Warning` with `incomplete: true`. Do not skip it quietly.
4. **No overclaiming.** Documentation must not claim perfect detection or regulatory compliance.
5. **Security issues** go through [SECURITY.md](SECURITY.md), not public issues.

## Development

```bash
npm ci
npm run typecheck     # strict TypeScript
npm run lint          # ESLint
npm run format        # Prettier
npm test              # unit + integration + security tests
npm run test:coverage
npm run build && npm run pack:check
node scripts/generate-fixtures.mjs   # writes synthetic sample files to test-fixtures/
```

The full test suite runs OCR locally. `@tesseract.js-data/eng` is a dev dependency, so no network is needed.

## Project layout

See the architecture table in the [README](README.md#3-architecture) and [docs/architecture.md](docs/architecture.md).

## Adding a detector or entity type

1. Add the type to `src/entities/entity-types.ts` and its definition (category, description) to `src/entities/entity-registry.ts`.
2. Add a `PatternRule` to the relevant detector (`pii-detector.ts`, `secret-detector.ts`) or a new `Detector`.
   - Use the Unicode-aware boundaries `WB` / `WE`, not `\b`.
   - Prefer validators (checksums, structural rules) and context keywords to reduce false positives.
   - Add context keywords in English, Hindi and Tamil where they apply.
   - Avoid nested quantifiers. Every pattern must pass the ReDoS tests in `tests/security/robustness.test.ts`.
3. Decide its action in every built-in policy (`src/policy/built-in-policies.ts`).
4. Add positive **and negative** tests.
5. Update `docs/detection.md`.

## Pull requests

- Keep PRs focused. Include tests, and documentation updates where behaviour changes.
- CI must pass: lint, typecheck, unit, integration and security tests, audit, build and package validation.
- Add a line to `CHANGELOG.md` under "Unreleased".
- By contributing you agree that your contributions are licensed under the Apache License 2.0.

## Maintainer

**AROCKIA INFANT RAJ M** ([infantraj01012003@gmail.com](mailto:infantraj01012003@gmail.com)), project author and maintainer.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
