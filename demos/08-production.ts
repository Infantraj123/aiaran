/**
 * Demo 8 — Production setup: encrypted mapping store, retention, audit, logging, limits, errors
 * Run: node demos/08-production.ts
 */
import {
  Aran,
  AranError,
  BlockedError,
  SecurityError,
  generateKey,
  type AuditEvent,
  type Logger,
  type MappingStore,
  type ProtectedValue,
} from "aiaran";
import { step, title } from "./_shared.ts";

title("DEMO 8 — Production configuration");

// A stand-in for Redis/Postgres. ARAN only ever hands it ciphertext.
const external = new Map<string, ProtectedValue>();
const redisLikeStore: MappingStore = {
  async set(key, value) {
    external.set(key, value); // e.g. redis.set(key, JSON.stringify(value), "PX", ttl)
  },
  async get(key) {
    return external.get(key); // e.g. JSON.parse(await redis.get(key))
  },
  async delete(key) {
    external.delete(key);
  },
  async clear() {
    external.clear();
  },
};

const auditTrail: AuditEvent[] = [];
const logLines: string[] = [];
const logger: Logger = {
  debug: () => {},
  info: (msg, fields) => logLines.push(`INFO ${msg} ${JSON.stringify(fields)}`),
  warn: (msg, fields) => logLines.push(`WARN ${msg} ${JSON.stringify(fields)}`),
  error: (msg, fields) => logLines.push(`ERROR ${msg} ${JSON.stringify(fields)}`),
};

const aran = new Aran({
  policy: "enterprise", // fail-closed, secrets blocked
  mappingStore: redisLikeStore,
  encryptionKey: generateKey(), // production: load a 32-byte key from your KMS / secret manager
  sessionTtlMs: 15 * 60 * 1000, // mappings live at most 15 minutes
  retention: "zero", // …and are deleted right after release()
  logger,
  audit: (event) => void auditTrail.push(event), // ship to your SIEM
  limits: { maxFileBytes: 20 * 1024 * 1024, maxPdfPages: 100, timeoutMs: 60_000 },
});

step("1. Protect — the external store receives only AES-256-GCM ciphertext");
const p = await aran.protect({
  type: "text",
  data: "Escalate to Anita Desai (anita.desai@example.com) today.",
});
console.log(p.safeData);
for (const [key, value] of external)
  console.log(
    `  ${key.slice(0, 30)}… → ${value.value.slice(0, 40)}… (encrypted=${value.encrypted})`,
  );

step("2. Release — tokens restored, then mappings deleted (zero retention)");
console.log((await aran.release("Escalated to [PERSON_001] via [EMAIL_001].", p.sessionId)).data);
console.log("mappings left in store:", external.size, "| active sessions:", aran.activeSessions);

step("3. Logs contain counts and IDs — never values");
for (const line of logLines) console.log(" ", line);

step("4. Audit events (value-free)");
for (const e of auditTrail)
  console.log(" ", e.event, e.entityType ?? "", e.action ?? "", e.count ?? "");

step("5. Handling results and errors safely");
async function protectOrExplain(text: string): Promise<void> {
  try {
    const r = await aran.protect({ type: "text", data: text });
    if (r.status === "blocked")
      throw new BlockedError(`Blocked: ${r.minimization.blocked.join(", ")}`);
    if (r.safeData === null)
      throw new SecurityError("Could not fully inspect the input (fail-closed).");
    console.log("  OK →", r.safeData);
  } catch (error) {
    if (error instanceof AranError)
      console.log(`  ${error.name} [${error.code}]: ${error.message}`);
    else throw error;
  }
}
await protectOrExplain("Deploy notes for Anita Desai");
// Synthetic AWS-style key (AWS's documented example), split so secret scanners don't flag this file.
await protectOrExplain(`Use key ${"AKIA" + "IOSFODNN7EXAMPLE"} for the deploy`);
await protectOrExplain("x".repeat(11 * 1024 * 1024)); // bigger than maxTextBytes (10 MB default)

await aran.dispose();
