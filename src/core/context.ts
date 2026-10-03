import type { EntityType } from "../entities/entity-types.js";
import { hmacSha256Hex, randomId } from "../security/hashing.js";
import { SecretKey } from "../security/secure-memory.js";
import { storeKey, type MappingStore } from "../restoration/mapping-store.js";

/**
 * Per-session tokenization state. The reverse index (value → token) is
 * keyed by an HMAC of the normalised value under a per-session random key,
 * so the index itself does not hold plaintext values.
 */
export class Session {
  readonly id: string;
  readonly createdAt = Date.now();
  expiresAt: number;
  private readonly key = new SecretKey();
  private readonly index = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  /** Tokens already present in input text that ARAN must not reuse. */
  private readonly reserved = new Set<string>();
  /** Store keys owned by this session, for cleanup. */
  readonly keys = new Set<string>();
  /** Pseudonym → token-key map used for pseudonym restoration. */
  readonly pseudonyms = new Map<string, string>();

  constructor(ttlMs: number, id?: string) {
    this.id = id ?? `ses_${randomId(16)}`;
    this.expiresAt = this.createdAt + ttlMs;
  }

  get expired(): boolean {
    return Date.now() >= this.expiresAt;
  }

  fingerprint(type: EntityType, normalizedValue: string): string {
    return hmacSha256Hex(this.key.value, `${type}\u0000${normalizedValue}`);
  }

  lookup(fingerprint: string): string | undefined {
    return this.index.get(fingerprint);
  }

  remember(fingerprint: string, token: string): void {
    this.index.set(fingerprint, token);
  }

  reserve(token: string): void {
    this.reserved.add(token);
  }

  nextNumber(
    type: EntityType,
    render: (n: number) => string,
  ): { n: number; token: string; skipped: boolean } {
    let n = (this.counters.get(type) ?? 0) + 1;
    let skipped = false;
    let token = render(n);
    while (this.reserved.has(token)) {
      n++;
      skipped = true;
      token = render(n);
    }
    this.counters.set(type, n);
    return { n, token, skipped };
  }

  storeKey(token: string): string {
    return storeKey(this.id, token);
  }

  /** Hash key bytes for deterministic pseudonym selection. */
  derive(label: string): string {
    return hmacSha256Hex(this.key.value, label);
  }

  async destroy(store: MappingStore): Promise<void> {
    await Promise.all([...this.keys].map((k) => store.delete(k)));
    this.keys.clear();
    this.index.clear();
    this.pseudonyms.clear();
    this.reserved.clear();
    this.key.destroy();
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly store: MappingStore,
    private readonly ttlMs: number,
  ) {}

  create(): Session {
    this.sweep();
    const session = new Session(this.ttlMs);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (session?.expired) {
      void this.destroy(id);
      return undefined;
    }
    return session;
  }

  /**
   * Extend a session's lifetime on use. Stored mappings carry their own
   * expiry (so external stores can expire them too); they are refreshed once
   * they are past half of their lifetime, to limit writes to external stores.
   */
  async touch(session: Session): Promise<void> {
    const now = Date.now();
    const needsRefresh = session.expiresAt - now < this.ttlMs / 2;
    session.expiresAt = now + this.ttlMs;
    if (!needsRefresh) return;
    await Promise.all(
      [...session.keys].map(async (key) => {
        const value = await this.store.get(key);
        if (value) await this.store.set(key, { ...value, expiresAt: session.expiresAt });
      }),
    );
  }

  async destroy(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    await session.destroy(this.store);
    return true;
  }

  async destroyAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.destroy(id)));
  }

  get size(): number {
    return this.sessions.size;
  }

  private sweep(): void {
    for (const [id, session] of this.sessions) if (session.expired) void this.destroy(id);
  }
}
