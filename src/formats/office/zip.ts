import { unzipSync, zipSync, type Unzipped, type ZipOptions } from "fflate";
import { DocumentProcessingError, SecurityError } from "../../core/errors.js";
import type { Limits } from "../../security/limits.js";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Safely extract a ZIP archive in memory with zip-bomb and path checks:
 * entry count, declared and actual uncompressed size, per-entry compression
 * ratio, and rejection of absolute/parent-relative paths.
 */
export function safeUnzip(buffer: Buffer, limits: Limits): ZipEntry[] {
  let count = 0;
  let declaredTotal = 0;
  const order: string[] = [];
  let files: Unzipped;
  try {
    files = unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), {
      filter(file) {
        count++;
        if (count > limits.maxZipEntries) {
          throw new SecurityError("Archive contains too many entries.", {
            details: { limit: limits.maxZipEntries },
          });
        }
        if (!isSafePath(file.name))
          throw new SecurityError("Archive contains an unsafe entry path.");
        declaredTotal += file.originalSize;
        if (declaredTotal > limits.maxUncompressedBytes) {
          throw new SecurityError("Archive uncompressed size exceeds the limit.", {
            details: { limit: limits.maxUncompressedBytes },
          });
        }
        if (
          file.originalSize > 1024 * 1024 &&
          file.size > 0 &&
          file.originalSize / file.size > limits.maxCompressionRatio
        ) {
          throw new SecurityError(
            "Archive entry compression ratio exceeds the limit (possible zip bomb).",
          );
        }
        order.push(file.name);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new DocumentProcessingError("Archive could not be read.", { cause: error });
  }
  let actualTotal = 0;
  const entries: ZipEntry[] = [];
  for (const name of order) {
    const data = files[name];
    if (!data) continue;
    actualTotal += data.length;
    if (actualTotal > limits.maxUncompressedBytes) {
      throw new SecurityError("Archive uncompressed size exceeds the limit.", {
        details: { limit: limits.maxUncompressedBytes },
      });
    }
    entries.push({ name, data });
  }
  return entries;
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const input: Record<string, [Uint8Array, ZipOptions]> = {};
  for (const e of entries) {
    // Already-compressed media is stored; XML is deflated.
    const level = /\.(png|jpe?g|gif|webp|tiff?|bmp|wdp|emf|wmf)$/i.test(e.name) ? 0 : 6;
    Object.defineProperty(input, e.name, { value: [e.data, { level }], enumerable: true });
  }
  return Buffer.from(zipSync(input));
}

function isSafePath(name: string): boolean {
  if (name.length === 0 || name.length > 512) return false;
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) return false;
  if (name.split(/[\\/]/).some((seg) => seg === "..")) return false;
  if (name.includes("\0")) return false;
  return true;
}
