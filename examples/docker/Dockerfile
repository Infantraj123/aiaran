# ARAN CLI image with fully offline OCR.
#   docker build -f examples/docker/Dockerfile -t aran .
#   docker run --rm --network none -v "$PWD:/data" aran scan /data/report.pdf
#   docker run --rm --network none -v "$PWD:/data" aran protect /data/letter.docx --mode document --out /data/letter.safe.docx

# 1. Build and pack the library exactly as it is published to npm.
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts README.md LICENSE NOTICE SECURITY.md CHANGELOG.md ./
COPY src ./src
RUN npm run build && mkdir -p /dist && npm pack --pack-destination /dist

# 2. Install the package like a consumer would, with the optional features.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
# Fonts for token labels drawn on redacted images and PDF pages.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /dist/*.tgz /tmp/
RUN npm init -y >/dev/null \
 && npm install --omit=dev /tmp/aiaran-*.tgz sharp tesseract.js @tesseract.js-data/eng pdfjs-dist pdf-lib \
 && rm /tmp/aiaran-*.tgz \
 && npm cache clean --force
USER node
ENTRYPOINT ["node", "/app/node_modules/aiaran/dist/cli.js"]
CMD ["--help"]
