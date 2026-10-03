import { describe, expect, it } from "vitest";
import { SecurityError } from "../../src/core/errors.js";
import { EncryptedMappingStore } from "../../src/protection/encryption.js";
import { MemoryMappingStore, type ProtectedValue } from "../../src/restoration/mapping-store.js";
import {
  decrypt,
  decryptString,
  deriveKeyFromPassphrase,
  encrypt,
  generateKey,
  normalizeKey,
} from "../../src/security/crypto.js";
import { SecretKey, wipe } from "../../src/security/secure-memory.js";

describe("AES-256-GCM", () => {
  it("round-trips with a random IV per message", () => {
    const key = generateKey();
    const a = encrypt("Ravi Kumar", key, "ctx");
    const b = encrypt("Ravi Kumar", key, "ctx");
    expect(a).not.toBe(b);
    expect(a).not.toContain("Ravi");
    expect(decryptString(a, key, "ctx")).toBe("Ravi Kumar");
  });

  it("detects tampering, wrong keys and wrong AAD", () => {
    const key = generateKey();
    const env = encrypt("secret", key, "aad1");
    const parts = env.split(".");
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], ct.toString("base64url")].join(".");
    expect(() => decrypt(tampered, key, "aad1")).toThrow(SecurityError);
    expect(() => decrypt(env, generateKey(), "aad1")).toThrow(SecurityError);
    expect(() => decrypt(env, key, "aad2")).toThrow(SecurityError);
    expect(() => decrypt("v1.bad", key)).toThrow(SecurityError);
  });

  it("normalises keys and rejects wrong sizes", () => {
    const key = generateKey();
    expect(normalizeKey(key.toString("hex")).equals(key)).toBe(true);
    expect(normalizeKey(key.toString("base64")).equals(key)).toBe(true);
    expect(() => normalizeKey("short")).toThrow(SecurityError);
  });

  it("derives keys from passphrases with scrypt", () => {
    const k = deriveKeyFromPassphrase("correct horse battery staple", "salt-1");
    expect(k).toHaveLength(32);
    expect(deriveKeyFromPassphrase("correct horse battery staple", "salt-1").equals(k)).toBe(true);
    expect(() => deriveKeyFromPassphrase("short", "s")).toThrow(SecurityError);
  });

  it("wipes key material", () => {
    const buf = Buffer.from([1, 2, 3]);
    wipe(buf);
    expect([...buf]).toEqual([0, 0, 0]);
    const k = new SecretKey();
    k.destroy();
    expect(k.destroyed).toBe(true);
    expect(() => k.value).toThrow();
  });
});

describe("EncryptedMappingStore", () => {
  const value: ProtectedValue = {
    entityType: "PERSON",
    value: "Ravi Kumar",
    restorable: true,
    createdAt: 1,
  };

  it("stores only ciphertext in the inner store", async () => {
    const inner = new MemoryMappingStore();
    const store = new EncryptedMappingStore(inner, generateKey());
    await store.set("s:[PERSON_001]", value);
    const raw = await inner.get("s:[PERSON_001]");
    expect(raw?.encrypted).toBe(true);
    expect(raw?.value).not.toContain("Ravi");
    expect(await store.get("s:[PERSON_001]")).toEqual(value);
  });

  it("binds ciphertext to its key and flags", async () => {
    const inner = new MemoryMappingStore();
    const store = new EncryptedMappingStore(inner, generateKey());
    await store.set("s:[PERSON_001]", value);
    const raw = (await inner.get("s:[PERSON_001]"))!;
    // Move the ciphertext to another token: must fail authentication.
    await inner.set("s:[PERSON_002]", raw);
    await expect(store.get("s:[PERSON_002]")).rejects.toThrow(SecurityError);
    // Flip the restorable flag: must fail authentication.
    await inner.set("s:[PERSON_001]", { ...raw, restorable: false });
    await expect(store.get("s:[PERSON_001]")).rejects.toThrow(SecurityError);
  });

  it("ignores unencrypted entries and refuses use after key destruction", async () => {
    const inner = new MemoryMappingStore();
    const store = new EncryptedMappingStore(inner);
    await inner.set("plain", value);
    expect(await store.get("plain")).toBeUndefined();
    store.destroyKey();
    await expect(store.set("x", value)).rejects.toThrow();
  });
});
