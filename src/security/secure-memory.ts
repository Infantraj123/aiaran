import { randomBytes } from "node:crypto";

/**
 * Best-effort handling of secret key material.
 *
 * JavaScript strings are immutable and garbage-collected, so ARAN cannot
 * guarantee that sensitive strings are erased from memory. Key material is
 * therefore kept in Buffers, which can be zeroed explicitly.
 */
export function wipe(buffer: Buffer | Uint8Array | undefined): void {
  if (buffer) buffer.fill(0);
}

export class SecretKey {
  private key: Buffer | undefined;

  constructor(key?: Buffer) {
    this.key = key ? Buffer.from(key) : randomBytes(32);
    if (key) wipe(key);
  }

  get value(): Buffer {
    if (!this.key) throw new Error("Secret key has been destroyed.");
    return this.key;
  }

  get destroyed(): boolean {
    return this.key === undefined;
  }

  destroy(): void {
    wipe(this.key);
    this.key = undefined;
  }
}
