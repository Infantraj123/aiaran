import { InputValidationError, SecurityError } from "../../core/errors.js";
import type { ProtectionContext } from "../../core/pipeline.js";
import { isDangerousKey } from "../../security/validation.js";
import type { TextSafeData } from "../../types/output.js";

/** Protect a string or a JSON-compatible structure. */
export async function processTextInput(
  ctx: ProtectionContext,
  data: unknown,
): Promise<TextSafeData> {
  if (typeof data === "string") {
    assertTextSize(data, ctx.limits.maxTextBytes);
    ctx.reserveExistingTokens(data);
    return (await ctx.processText(data)).text;
  }
  if (data === null || typeof data !== "object") {
    throw new InputValidationError("Text input data must be a string, object or array.");
  }
  const state = { nodes: 0, bytes: 0 };
  // Reserve tokens across the whole structure first, so numbering is consistent.
  collectStrings(data, 0, ctx, state, (s) => ctx.reserveExistingTokens(s));
  return (await walk(ctx, data, 0, undefined)) as TextSafeData;
}

function assertTextSize(text: string, max: number): void {
  if (Buffer.byteLength(text, "utf8") > max) {
    throw new SecurityError("Text input exceeds the maximum allowed size.", {
      details: { limit: max },
    });
  }
}

function collectStrings(
  value: unknown,
  depth: number,
  ctx: ProtectionContext,
  state: { nodes: number; bytes: number },
  visit: (s: string) => void,
): void {
  if (++state.nodes > ctx.limits.maxObjectNodes) {
    throw new SecurityError("Structured input has too many nodes.", {
      details: { limit: ctx.limits.maxObjectNodes },
    });
  }
  if (depth > ctx.limits.maxObjectDepth) {
    throw new SecurityError("Structured input is nested too deeply.", {
      details: { limit: ctx.limits.maxObjectDepth },
    });
  }
  if (typeof value === "string") {
    state.bytes += Buffer.byteLength(value, "utf8");
    if (state.bytes > ctx.limits.maxTextBytes) {
      throw new SecurityError("Text input exceeds the maximum allowed size.", {
        details: { limit: ctx.limits.maxTextBytes },
      });
    }
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, depth + 1, ctx, state, visit);
    return;
  }
  if (value !== null && typeof value === "object") {
    if (!isPlainObject(value)) {
      throw new InputValidationError(
        "Structured input may only contain plain objects, arrays and primitive values.",
      );
    }
    for (const [key, item] of Object.entries(value)) {
      visit(key);
      collectStrings(item, depth + 1, ctx, state, visit);
    }
  }
}

async function walk(
  ctx: ProtectionContext,
  value: unknown,
  depth: number,
  key: string | undefined,
): Promise<unknown> {
  if (typeof value === "string") {
    return (await ctx.processText(value, key !== undefined ? { fieldName: key } : {})).text;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    // Numbers in sensitive fields (e.g. "phone": 9876543210) are protected as text.
    if (key === undefined) return value;
    const asText = String(value);
    const result = await ctx.processText(asText, { fieldName: key });
    return result.replacements.length > 0 ? result.text : value;
  }
  if (value === null || typeof value === "boolean" || value === undefined) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(await walk(ctx, item, depth + 1, key));
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isDangerousKey(k)) continue; // never copy prototype-polluting keys
      const safeKey = (await ctx.processText(k)).text;
      const protectedValue = await walk(ctx, v, depth + 1, k);
      Object.defineProperty(out, safeKey, {
        value: protectedValue,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  throw new InputValidationError("Unsupported value type in structured input.");
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}
