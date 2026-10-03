# Docker

The image runs the `aran` CLI with local OCR (English model bundled), image processing and PDF support. It needs no network access at runtime, so run it with `--network none`.

```bash
docker build -f examples/docker/Dockerfile -t aran .

docker run --rm --network none -v "$PWD:/data" aran scan /data/test-fixtures/sample-scanned.pdf
docker run --rm --network none -v "$PWD:/data" aran protect /data/test-fixtures/sample-letter.docx \
  --mode document --out /data/letter.safe.docx
```

To add OCR languages, extend the image with `@tesseract.js-data/hin` / `@tesseract.js-data/tam` and pass `--ocr-lang` together with a shared `langPath` in a custom policy runner (see the README OCR note).
