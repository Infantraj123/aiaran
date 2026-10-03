import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { SecurityError } from "../core/errors.js";

/**
 * Authenticated encryption with AES-256-GCM (Node.js native crypto).
 *
 * Envelope format (base64url segments): `v1.<iv>.<tag>.<ciphertext>`
 * - 96-bit random IV per message
 * - 128-bit authentication tag
 * - optional additional authenticated data (AAD) binds ciphertext to context
 */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * Accept a 32-byte key as a Buffer, or as a hex/base64 string.
 * Never accepts short passphrases directly — use `deriveKeyFromPassphrase`.
 */
export function normalizeKey(key: Buffer | Uint8Array | string): Buffer {
  let buf: Buffer;
  if (typeof key === "string") {
    if (/^[0-9a-fA-F]{64}$/.test(key)) buf = Buffer.from(key, "hex");
    else buf = Buffer.from(key, "base64");
  } else {
    buf = Buffer.from(key);
  }
  if (buf.length !== KEY_BYTES) {
    throw new SecurityError("Encryption key must be exactly 32 bytes (AES-256).", {
      details: { expectedBytes: KEY_BYTES, actualBytes: buf.length },
    });
  }
  return buf;
}

/** Derive a 256-bit key from a passphrase using scrypt (N=2^15, r=8, p=1). */
export function deriveKeyFromPassphrase(passphrase: string, salt: Buffer | string): Buffer {
  if (passphrase.length < 12) {
    throw new SecurityError("Passphrase must be at least 12 characters.");
  }
  return scryptSync(passphrase, salt, KEY_BYTES, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

export function encrypt(plaintext: string | Buffer, key: Buffer, aad?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decrypt(envelope: string, key: Buffer, aad?: string): Buffer {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecurityError("Malformed encrypted payload.");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecurityError("Malformed encrypted payload.");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new SecurityError("Decryption failed: payload was tampered with or the key is wrong.", {
      cause: error,
    });
  }
}

export function decryptString(envelope: string, key: Buffer, aad?: string): string {
  return decrypt(envelope, key, aad).toString("utf8");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
