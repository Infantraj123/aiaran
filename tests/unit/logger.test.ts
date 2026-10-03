import { describe, expect, it, vi } from "vitest";
import {
  ConsoleLogger,
  SafeLogger,
  sanitizeFields,
  type Logger,
} from "../../src/logging/logger.js";
import { Auditor } from "../../src/logging/audit.js";

describe("logging", () => {
  it("keeps only allowlisted fields", () => {
    const out = sanitizeFields({
      requestId: "req_1",
      entityCounts: { EMAIL: 2, leaked: "ravi@example.com" },
      prompt: "My name is Ravi",
      value: "ravi@example.com",
      warningCodes: ["OCR_FAILED", { x: 1 }],
    });
    expect(out).toEqual({
      requestId: "req_1",
      entityCounts: { EMAIL: 2 },
      warningCodes: ["OCR_FAILED"],
    });
  });

  it("sanitizes fields passed to custom loggers", () => {
    const inner: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    new SafeLogger(inner).info("x", { requestId: "r", text: "secret" });
    expect(inner.info).toHaveBeenCalledWith("x", { requestId: "r" });
  });

  it("respects the console log level and writes to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    new ConsoleLogger("warn").info("hidden");
    expect(spy).not.toHaveBeenCalled();
    new ConsoleLogger("info").info("shown", { requestId: "r", data: "secret" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).not.toContain("secret");
    spy.mockRestore();
  });

  it("isolates audit sink failures", () => {
    const auditor = new Auditor(() => {
      throw new Error("sink down");
    });
    expect(() => auditor.emit({ event: "SESSION_CREATED" })).not.toThrow();
    const asyncAuditor = new Auditor(() => Promise.reject(new Error("x")));
    expect(() => asyncAuditor.emit({ event: "SESSION_CREATED" })).not.toThrow();
  });
});
