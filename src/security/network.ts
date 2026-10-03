import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { SecurityError } from "../core/errors.js";

/**
 * SSRF helpers. ARAN V1 does not fetch user-supplied URLs; these helpers are
 * used to classify URLs during detection (INTERNAL_URL) and are provided for
 * any future URL-ingestion feature.
 */
export type HostClass =
  | "public"
  | "loopback"
  | "private"
  | "link-local"
  | "unspecified"
  | "metadata"
  | "multicast"
  | "reserved"
  | "internal-name";

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
  "metadata.azure.com",
]);

const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".corp",
  ".lan",
  ".home",
  ".home.arpa",
  ".private",
  ".localdomain",
  ".svc",
  ".cluster.local",
];

export function classifyIPv4(ip: string): HostClass {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return "reserved";
  const [a, b] = parts as [number, number, number, number];
  if (ip === "169.254.169.254" || ip === "100.100.100.200") return "metadata";
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT
  if (a === 169 && b === 254) return "link-local";
  if (a === 192 && b === 0 && parts[2] === 0) return "reserved";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  return "public";
}

export function classifyIPv6(ip: string): HostClass {
  const lower =
    ip
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] ?? "";
  if (lower === "::") return "unspecified";
  if (lower === "::1") return "loopback";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return classifyIPv4(mapped[1]);
  if (lower === "fd00:ec2::254") return "metadata";
  if (/^fe[89ab]/.test(lower)) return "link-local";
  if (/^f[cd]/.test(lower)) return "private";
  if (/^ff/.test(lower)) return "multicast";
  return "public";
}

/** Classify a hostname or IP literal without DNS resolution. */
export function classifyHost(host: string): HostClass {
  const h = host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  const ipVersion = isIP(h);
  if (ipVersion === 4) return classifyIPv4(h);
  if (ipVersion === 6) return classifyIPv6(h);
  // Integer / hex / octal IPv4 encodings (e.g. http://2130706433/) are treated as reserved.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) return "reserved";
  if (METADATA_HOSTS.has(h)) return "metadata";
  if (h === "localhost") return "loopback";
  if (!h.includes(".")) return "internal-name";
  if (INTERNAL_SUFFIXES.some((s) => h.endsWith(s))) return "internal-name";
  return "public";
}

export function isInternalHost(host: string): boolean {
  return classifyHost(host) !== "public";
}

export interface UrlSafetyOptions {
  allowedProtocols?: string[];
  /** Resolve DNS and check every returned address (default true). */
  resolveDns?: boolean;
}

/**
 * Throw a SecurityError unless `rawUrl` points at a public host over an allowed
 * protocol. Resolves DNS so that public names pointing at private addresses
 * are rejected. Callers must also disable redirects or re-validate each hop.
 */
export async function assertPublicUrl(
  rawUrl: string,
  options: UrlSafetyOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new SecurityError("Invalid URL.", { cause: error });
  }
  const protocols = options.allowedProtocols ?? ["https:"];
  if (!protocols.includes(url.protocol)) {
    throw new SecurityError("URL protocol is not allowed.", {
      details: { protocol: url.protocol },
    });
  }
  if (url.username || url.password) {
    throw new SecurityError("URLs with embedded credentials are not allowed.");
  }
  const hostClass = classifyHost(url.hostname);
  if (hostClass !== "public") {
    throw new SecurityError("URL host is not a public address.", { details: { hostClass } });
  }
  if (options.resolveDns !== false) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    for (const { address } of addresses) {
      const cls = classifyHost(address);
      if (cls !== "public") {
        throw new SecurityError("URL resolves to a non-public address.", {
          details: { hostClass: cls },
        });
      }
    }
  }
  return url;
}
