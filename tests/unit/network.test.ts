import { describe, expect, it, vi } from "vitest";
import { SecurityError } from "../../src/core/errors.js";
import { assertPublicUrl, classifyHost } from "../../src/security/network.js";

describe("SSRF host classification", () => {
  it.each([
    ["localhost", "loopback"],
    ["127.0.0.1", "loopback"],
    ["::1", "loopback"],
    ["[::1]", "loopback"],
    ["0.0.0.0", "unspecified"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["192.168.0.1", "private"],
    ["100.64.0.1", "private"],
    ["fd00::1", "private"],
    ["169.254.10.10", "link-local"],
    ["fe80::1", "link-local"],
    ["169.254.169.254", "metadata"],
    ["metadata.google.internal", "metadata"],
    ["::ffff:127.0.0.1", "loopback"],
    ["2130706433", "reserved"],
    ["0x7f000001", "reserved"],
    ["intranet", "internal-name"],
    ["db.corp", "internal-name"],
    ["svc.cluster.local", "internal-name"],
    ["example.com", "public"],
    ["8.8.8.8", "public"],
  ])("%s → %s", (host, cls) => {
    expect(classifyHost(host)).toBe(cls);
  });
});

describe("assertPublicUrl", () => {
  it("rejects internal targets, bad protocols and embedded credentials", async () => {
    await expect(
      assertPublicUrl("http://127.0.0.1/", { allowedProtocols: ["http:"], resolveDns: false }),
    ).rejects.toThrow(SecurityError);
    await expect(
      assertPublicUrl("https://169.254.169.254/latest/meta-data", { resolveDns: false }),
    ).rejects.toThrow(SecurityError);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(SecurityError);
    await expect(
      assertPublicUrl("https://user:pw@example.com/", { resolveDns: false }),
    ).rejects.toThrow(SecurityError);
    await expect(assertPublicUrl("not a url")).rejects.toThrow(SecurityError);
  });

  it("accepts public URLs without DNS resolution", async () => {
    await expect(
      assertPublicUrl("https://example.com/x", { resolveDns: false }),
    ).resolves.toBeInstanceOf(URL);
  });

  it("rejects public-looking hostnames that resolve to private addresses (DNS rebinding)", async () => {
    vi.resetModules();
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    }));
    const { assertPublicUrl: check } = await import("../../src/security/network.js");
    await expect(check("https://rebind.example.com/")).rejects.toThrow(/non-public address/);
    vi.doUnmock("node:dns/promises");
  });
});
