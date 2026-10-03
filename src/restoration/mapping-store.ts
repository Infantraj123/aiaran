import type { EntityType } from "../entities/entity-types.js";

/** A protected original value stored for later restoration. */
export interface ProtectedValue {
  readonly entityType: EntityType;
  /** Original value, or an AES-256-GCM envelope when `encrypted` is true. */
  readonly value: string;
  readonly restorable: boolean;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly encrypted?: boolean;
}

/**
 * Storage for token → original value mappings. Keys are namespaced by
 * session (`<sessionId>:<token>`). Implementations that persist data must
 * be used together with `EncryptedMappingStore`.
 */
export interface MappingStore {
  set(token: string, value: ProtectedValue): Promise<void>;
  get(token: string): Promise<ProtectedValue | undefined>;
  delete(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** Default in-process store. Nothing is persisted; expired entries are dropped on access. */
export class MemoryMappingStore implements MappingStore {
  private readonly map = new Map<string, ProtectedValue>();

  async set(token: string, value: ProtectedValue): Promise<void> {
    this.map.set(token, value);
  }

  async get(token: string): Promise<ProtectedValue | undefined> {
    const value = this.map.get(token);
    if (value?.expiresAt !== undefined && value.expiresAt <= Date.now()) {
      this.map.delete(token);
      return undefined;
    }
    return value;
  }

  async delete(token: string): Promise<void> {
    this.map.delete(token);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  /** Number of stored mappings (for diagnostics and tests; never exposes values). */
  get size(): number {
    return this.map.size;
  }

  sweepExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, value] of this.map) {
      if (value.expiresAt !== undefined && value.expiresAt <= now) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

export function storeKey(sessionId: string, token: string): string {
  return `${sessionId}:${token}`;
}
