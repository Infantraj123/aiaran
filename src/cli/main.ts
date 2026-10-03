import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Aran } from "../core/aran.js";
import { AranError } from "../core/errors.js";
import { BUILT_IN_ENTITIES } from "../entities/entity-registry.js";
import { BUILT_IN_POLICIES } from "../policy/built-in-policies.js";
import {
  parsePolicyText,
  resolvePolicy,
  validatePolicyDefinition,
} from "../policy/policy-loader.js";
import type { PolicyInput } from "../policy/policy.js";
import { PROVIDERS } from "../providers/generic.js";
import { DEFAULT_LIMITS } from "../security/limits.js";
import {
  extensionOf,
  inputTypeForExtension,
  inputTypeForFormat,
  sniffFormat,
} from "../security/validation.js";
import type { DocumentMode, InputType, ProtectInput } from "../types/input.js";
import type {
  DocumentSafeData,
  ImageSafeData,
  ProtectionSummary,
  Warning,
} from "../types/output.js";
import { VERSION } from "../version.js";
import { runDoctor } from "./doctor.js";
import type { TesseractEngineOptions } from "../ocr/tesseract-engine.js";

const HELP = `ARAN ${VERSION} — local-first AI privacy scanner

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
so tokens in protected files cannot be restored.`;

interface CliOptions {
  type?: string;
  policy?: string;
  mode?: string;
  out?: string;
  force?: boolean;
  json?: boolean;
  "ocr-lang"?: string;
  "ocr-path"?: string;
  help?: boolean;
  version?: boolean;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      type: { type: "string" },
      policy: { type: "string" },
      mode: { type: "string" },
      out: { type: "string", short: "o" },
      force: { type: "boolean", short: "f" },
      json: { type: "boolean" },
      "ocr-lang": { type: "string" },
      "ocr-path": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const opts = values as CliOptions;
  if (opts.version) return (print(VERSION), 0);
  const [command, sub, arg] = positionals;
  if (opts.help || !command) return (print(HELP), command ? 0 : 1);

  switch (command) {
    case "scan":
      return scanCommand(requireArg(sub, "file"), opts);
    case "protect":
      return protectCommand(requireArg(sub, "file"), opts);
    case "policy":
      if (sub === "validate") return validateCommand(requireArg(arg, "policy file"), opts);
      break;
    case "policies":
      if (sub === "list" || sub === undefined) return listPolicies(opts);
      break;
    case "entities":
      if (sub === "list" || sub === undefined) return listEntities(opts);
      break;
    case "providers":
      if (sub === "list" || sub === undefined) return listProviders(opts);
      break;
    case "doctor":
      return doctorCommand(opts);
  }
  printErr(`Unknown command. Run "aran --help".`);
  return 1;
}

function requireArg(value: string | undefined, name: string): string {
  if (!value) throw new CliError(`Missing ${name}. Run "aran --help".`);
  return value;
}

class CliError extends Error {}

async function loadInput(
  file: string,
  opts: CliOptions,
): Promise<{ input: ProtectInput; type: InputType }> {
  let data: Buffer;
  if (file === "-") {
    data = await readStdin(DEFAULT_LIMITS.maxFileBytes);
  } else {
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) throw new CliError("Input file not found or not a regular file.");
    if (info.size > DEFAULT_LIMITS.maxFileBytes)
      throw new CliError("Input file exceeds the maximum allowed size.");
    data = await readFile(file);
  }
  const type = resolveType(file, data, opts.type);
  const mode = parseMode(opts.mode);
  const filename = file === "-" ? undefined : basename(file);
  let input: ProtectInput;
  switch (type) {
    case "text":
      input = { type, data: data.toString("utf8") };
      break;
    case "image":
      input = { type, data, ...(filename ? { filename } : {}) };
      break;
    case "pdf":
    case "docx":
      input = {
        type,
        data,
        mode,
        ...(filename && extensionOf(filename) !== "doc" ? { filename } : {}),
      };
      break;
  }
  return { input, type };
}

function resolveType(file: string, data: Buffer, explicit: string | undefined): InputType {
  if (explicit !== undefined) {
    if (!["text", "image", "pdf", "docx"].includes(explicit))
      throw new CliError("--type must be text, image, pdf or docx.");
    return explicit as InputType;
  }
  // A recognised extension wins (the content is still validated against it);
  // otherwise fall back to magic-byte sniffing, then plain text.
  const byExt = file === "-" ? undefined : inputTypeForExtension(extensionOf(file));
  if (byExt) return byExt;
  return inputTypeForFormat(sniffFormat(data)) ?? "text";
}

function parseMode(mode: string | undefined): DocumentMode {
  if (mode === undefined || mode === "content") return "content";
  if (mode === "document") return "document";
  throw new CliError("--mode must be content or document.");
}

async function createAran(opts: CliOptions): Promise<Aran> {
  let policy: PolicyInput = "default";
  if (opts.policy) {
    if (opts.policy in BUILT_IN_POLICIES) policy = opts.policy;
    else {
      const text = await readFile(opts.policy, "utf8").catch(() => {
        throw new CliError("Policy is neither a built-in policy name nor a readable file.");
      });
      policy = parsePolicyText(
        text,
        extensionOf(opts.policy) === "json" ? "json" : "yaml",
      ) as PolicyInput;
    }
  }
  return new Aran({ policy, logger: false, ocr: ocrOptions(opts) });
}

function ocrOptions(opts: CliOptions): TesseractEngineOptions {
  const languages = opts["ocr-lang"]
    ?.split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    ...(languages && languages.length > 0 ? { languages } : {}),
    ...(opts["ocr-path"] ? { langPath: resolve(opts["ocr-path"]) } : {}),
  };
}

async function scanCommand(file: string, opts: CliOptions): Promise<number> {
  const { input } = await loadInput(file, opts);
  const aran = await createAran(opts);
  try {
    const result = await aran.scan(input);
    if (opts.json) {
      print(
        JSON.stringify(
          {
            type: result.type,
            status: result.status,
            summary: result.summary,
            warnings: result.warnings,
            metadata: result.metadata,
          },
          null,
          2,
        ),
      );
    } else {
      print("ARAN Privacy Scanner\n");
      printSummary(result.summary);
      printWarnings(result.warnings);
      if (result.status === "incomplete")
        print("\nScan incomplete: some content could not be inspected.");
      print("\nNo sensitive values displayed.");
    }
    return 0;
  } finally {
    await aran.dispose();
  }
}

async function protectCommand(file: string, opts: CliOptions): Promise<number> {
  const { input, type } = await loadInput(file, opts);
  const aran = await createAran(opts);
  try {
    const result = await aran.protect(input);
    let outPath: string | undefined;
    if (result.safeData !== null) {
      const { bytes, ext } = serialize(type, result.safeData, input);
      outPath = opts.out ?? defaultOutPath(file, ext);
      if (file !== "-" && resolve(outPath) === resolve(file))
        throw new CliError("Refusing to overwrite the input file.");
      const exists = await stat(outPath).then(
        () => true,
        () => false,
      );
      if (exists && !opts.force)
        throw new CliError("Output file exists. Use --force to overwrite.");
      await writeFile(outPath, bytes, { mode: 0o600 });
    }
    await aran.destroySession(result.sessionId);

    if (opts.json) {
      print(
        JSON.stringify(
          {
            status: result.status,
            output: outPath ?? null,
            summary: result.summary,
            minimization: result.minimization,
            warnings: result.warnings,
          },
          null,
          2,
        ),
      );
    } else {
      print("ARAN Privacy Protection\n");
      printSummary(result.summary);
      printWarnings(result.warnings);
      print("");
      if (result.status === "blocked")
        print(
          `BLOCKED by policy "${result.policy}" (${result.minimization.blocked.join(", ")}). No output written.`,
        );
      else if (outPath) print(`Status: ${result.status.toUpperCase()}\nWritten: ${outPath}`);
      else print("Content could not be fully inspected; output withheld (fail-closed).");
      print("No sensitive values displayed.");
    }
    if (result.status === "blocked") return 3;
    if (result.safeData === null) return 4;
    return 0;
  } finally {
    await aran.dispose();
  }
}

function serialize(
  type: InputType,
  data: unknown,
  input: ProtectInput,
): { bytes: Buffer; ext: string } {
  if (type === "text")
    return {
      bytes: Buffer.from(typeof data === "string" ? data : JSON.stringify(data, null, 2)),
      ext: "txt",
    };
  if (type === "image") return { bytes: (data as ImageSafeData).image, ext: "png" };
  const doc = data as DocumentSafeData;
  const mode = (input as { mode?: DocumentMode }).mode;
  if (mode === "document" && doc.document) return { bytes: doc.document, ext: type };
  return { bytes: Buffer.from(doc.text), ext: "txt" };
}

function defaultOutPath(file: string, ext: string): string {
  if (file === "-") return `stdin.protected.${ext}`;
  const base = basename(file, extname(file));
  return join(dirname(file), `${base}.protected.${ext}`);
}

async function validateCommand(file: string, opts: CliOptions): Promise<number> {
  const text = await readFile(file, "utf8").catch(() => {
    throw new CliError("Policy file not found.");
  });
  const raw = parsePolicyText(text, extensionOf(file) === "json" ? "json" : "yaml");
  const known = new Set(BUILT_IN_ENTITIES.map((e) => e.name));
  const issues = validatePolicyDefinition(raw, known);
  const errors = issues.filter((i) => i.severity === "error");
  let name: string | undefined;
  if (errors.length === 0) name = resolvePolicy(raw as PolicyInput, known).name;
  if (opts.json)
    print(JSON.stringify({ valid: errors.length === 0, name: name ?? null, issues }, null, 2));
  else {
    for (const i of issues) print(`${i.severity.toUpperCase().padEnd(8)} ${i.path}: ${i.message}`);
    print(
      errors.length === 0
        ? `Policy "${name}" is valid.`
        : `Policy is invalid (${errors.length} error(s)).`,
    );
  }
  return errors.length === 0 ? 0 : 2;
}

async function doctorCommand(opts: CliOptions): Promise<number> {
  const checks = await runDoctor(ocrOptions(opts));
  if (opts.json) {
    print(JSON.stringify(checks, null, 2));
  } else {
    print(`ARAN ${VERSION} — environment check\n`);
    const icon = { ok: "✓", missing: "✗", warning: "!" } as const;
    for (const c of checks) {
      print(`${icon[c.status]} ${c.feature.padEnd(44)} ${c.detail}`);
      if (c.fix && c.status !== "ok") print(`  ${"".padEnd(44)} → ${c.fix}`);
    }
  }
  return checks.some((c) => c.feature === "Node.js" && c.status === "missing") ? 1 : 0;
}

function listPolicies(opts: CliOptions): number {
  const rows = Object.values(BUILT_IN_POLICIES).map((p) => ({
    name: p.name,
    failMode: p.failMode,
    description: p.description ?? "",
  }));
  if (opts.json) print(JSON.stringify(rows, null, 2));
  else
    for (const r of rows)
      print(`${r.name.padEnd(12)} fail-${r.failMode.padEnd(7)} ${r.description}`);
  return 0;
}

function listEntities(opts: CliOptions): number {
  const rows = BUILT_IN_ENTITIES.map((e) => ({
    name: e.name,
    category: e.category,
    description: e.description,
  }));
  if (opts.json) print(JSON.stringify(rows, null, 2));
  else
    for (const r of rows) print(`${r.name.padEnd(24)} ${r.category.padEnd(12)} ${r.description}`);
  return 0;
}

function listProviders(opts: CliOptions): number {
  if (opts.json) print(JSON.stringify(PROVIDERS, null, 2));
  else
    for (const p of PROVIDERS)
      print(
        `${p.name.padEnd(18)} ${p.adapter.padEnd(26)} ${p.dependency.padEnd(36)} ${p.description}`,
      );
  return 0;
}

function printSummary(summary: ProtectionSummary): void {
  const entries = Object.entries(summary.counts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (entries.length === 0) print("No sensitive entities detected.");
  for (const [type, count] of entries) print(`${type.padEnd(24)}${count}`);
  print(`\nRisk level: ${summary.riskLevel}`);
}

function printWarnings(warnings: Warning[]): void {
  const relevant = warnings.filter((w) => w.severity !== "info");
  if (relevant.length === 0) return;
  print("\nWarnings:");
  for (const w of relevant)
    print(`  [${w.code}]${w.page !== undefined ? ` page ${w.page}:` : ""} ${w.message}`);
}

async function readStdin(limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new CliError("Input exceeds the maximum allowed size.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function print(s: string): void {
  process.stdout.write(`${s}\n`);
}

function printErr(s: string): void {
  process.stderr.write(`aran: ${s}\n`);
}

const isEntry =
  process.argv[1] !== undefined && /(?:^|[\\/])(?:cli\.js|main\.ts|aran)$/.test(process.argv[1]);
if (isEntry) {
  // Exit quietly when the reader closes the pipe early (e.g. `aran entities list | head`).
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // AranError messages never contain input values; other errors are summarised generically.
      if (error instanceof CliError || error instanceof AranError) printErr(error.message);
      else if (
        error instanceof Error &&
        "code" in error &&
        String((error as { code: unknown }).code).startsWith("ERR_PARSE_ARGS")
      )
        printErr(error.message);
      else printErr("Unexpected error. No sensitive values were written.");
      process.exitCode = 1;
    },
  );
}
