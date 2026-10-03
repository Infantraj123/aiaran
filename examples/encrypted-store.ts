import { Aran, generateKey, type MappingStore, type ProtectedValue } from "aiaran";

// A stand-in for Redis or another external store. ARAN encrypts every value
// with AES-256-GCM before it reaches the store.
const external = new Map<string, ProtectedValue>();
const store: MappingStore = {
  set: async (k, v) => void external.set(k, v),
  get: async (k) => external.get(k),
  delete: async (k) => void external.delete(k),
  clear: async () => external.clear(),
};

const aran = new Aran({
  mappingStore: store,
  encryptionKey: generateKey(), // in production: a 32-byte key from your KMS
  retention: "zero", // mappings are destroyed right after release()
});

const p = await aran.protect({ type: "text", data: "Call Ravi Kumar on +91 98765 43210" });
console.log(
  "stored ciphertext:",
  [...external.values()].map((v) => v.value.slice(0, 24) + "…"),
);
console.log(await aran.restore("Calling [PERSON_001] at [PHONE_001]", p.sessionId));
console.log("mappings left:", external.size); // 0 (zero retention)
await aran.dispose();
