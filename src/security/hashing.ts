import { createHash, createHmac, randomBytes } from "node:crypto";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacSha256(key: Buffer, data: string | Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export function hmacSha256Hex(key: Buffer, data: string | Buffer): string {
  return hmacSha256(key, data).toString("hex");
}

/** Random, URL-safe identifier (default 128 bits). */
export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}
