import { decryptString, encrypt, normalizeKey } from "../security/crypto.js";
import { SecretKey } from "../security/secure-memory.js";
import type { MappingStore, ProtectedValue } from "../restoration/mapping-store.js";

/**
 * Wraps any MappingStore and encrypts original values with AES-256-GCM.
 * The storage key, entity type and restorable flag are bound to the
 * ciphertext as additional authenticated data, so a value cannot be moved
 * to another token or have its flags altered without detection.
 *
 * Use this for every store that persists data outside the process.
 */
export class EncryptedMappingStore implements MappingStore {
  private readonly key: SecretKey;

  constructor(
    private readonly inner: MappingStore,
    key?: Buffer | Uint8Array | string,
  ) {
    this.key = new SecretKey(key === undefined ? undefined : normalizeKey(key));
  }

  async set(token: string, value: ProtectedValue): Promise<void> {
    const envelope = encrypt(value.value, this.key.value, aad(token, value));
    await this.inner.set(token, { ...value, value: envelope, encrypted: true });
  }

  async get(token: string): Promise<ProtectedValue | undefined> {
    const stored = await this.inner.get(token);
    if (!stored) return undefined;
    if (!stored.encrypted) return undefined; // never trust unencrypted entries in an encrypted store
    const value = decryptString(stored.value, this.key.value, aad(token, stored));
    const { encrypted: _encrypted, ...rest } = stored;
    return { ...rest, value };
  }

  delete(token: string): Promise<void> {
    return this.inner.delete(token);
  }

  async clear(): Promise<void> {
    await this.inner.clear();
  }

  /** Zero the in-memory key. The store cannot be used afterwards. */
  destroyKey(): void {
    this.key.destroy();
  }
}

function aad(token: string, value: Pick<ProtectedValue, "entityType" | "restorable">): string {
  return `aran:v1|${token}|${value.entityType}|${value.restorable ? 1 : 0}`;
}
