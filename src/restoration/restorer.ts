import type { Session } from "../core/context.js";
import type { Warning } from "../types/output.js";
import type { MappingStore } from "./mapping-store.js";

/**
 * Matches ARAN tokens in AI output, tolerating common model rewrites:
 * `[PERSON_001]`, `PERSON_001`, `[person_001]`, `[PERSON 001]`.
 */
const TOKEN_LIKE_RE =
  /\[?(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z][A-Za-z0-9]*)*)[_ ](\d{3,})(?![A-Za-z0-9_])\]?/g;

export interface RestoreOutcome {
  text: string;
  restored: number;
  unrestored: number;
  warnings: Warning[];
  /** Spans in the restored text that contain restored original values. */
  restoredSpans: { start: number; end: number }[];
}

export class Restorer {
  constructor(private readonly store: MappingStore) {}

  async restore(text: string, session: Session): Promise<RestoreOutcome> {
    const warnings: Warning[] = [];
    let restored = 0;
    let notRestorable = 0;
    let unknown = 0;

    const pieces: { start: number; end: number; value: string | undefined }[] = [];
    TOKEN_LIKE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_LIKE_RE.exec(text)) !== null) {
      const type = (m[1] ?? "").toUpperCase();
      const token = `[${type}_${m[2]}]`;
      const bracketed = m[0].startsWith("[") && m[0].endsWith("]");
      const key = session.storeKey(token);
      if (!session.keys.has(key)) {
        if (bracketed) unknown++;
        continue;
      }
      const stored = await this.store.get(key);
      if (!stored) {
        unknown++;
        continue;
      }
      if (!stored.restorable) {
        notRestorable++;
        continue;
      }
      // Only consume brackets that belong to the token.
      let start = m.index;
      let end = m.index + m[0].length;
      if (m[0].startsWith("[") && !m[0].endsWith("]")) start++;
      if (!m[0].startsWith("[") && m[0].endsWith("]")) end--;
      pieces.push({ start, end, value: stored.value });
      restored++;
    }

    // Pseudonyms are restored by exact match, longest first.
    if (session.pseudonyms.size > 0) {
      const sorted = [...session.pseudonyms.keys()].sort((a, b) => b.length - a.length);
      for (const pseudo of sorted) {
        let from = 0;
        let idx: number;
        while ((idx = text.indexOf(pseudo, from)) !== -1) {
          from = idx + pseudo.length;
          if (pieces.some((p) => idx < p.end && p.start < idx + pseudo.length)) continue;
          const stored = await this.store.get(session.pseudonyms.get(pseudo)!);
          if (!stored) continue;
          if (!stored.restorable) {
            notRestorable++;
            continue;
          }
          pieces.push({ start: idx, end: idx + pseudo.length, value: stored.value });
          restored++;
        }
      }
    }

    const unrestored = notRestorable + unknown;
    if (notRestorable > 0) {
      warnings.push({
        code: "TOKEN_NOT_RESTORABLE",
        message: `${notRestorable} token(s) were left in place because policy forbids restoring them.`,
        severity: "info",
      });
    }
    if (unknown > 0) {
      warnings.push({
        code: "UNKNOWN_TOKEN",
        message: `${unknown} token-like placeholder(s) did not belong to this session and were left unchanged.`,
        severity: "warning",
      });
    }

    pieces.sort((a, b) => a.start - b.start);
    let out = "";
    let cursor = 0;
    const restoredSpans: { start: number; end: number }[] = [];
    for (const p of pieces) {
      if (p.start < cursor || p.value === undefined) continue;
      out += text.slice(cursor, p.start);
      restoredSpans.push({ start: out.length, end: out.length + p.value.length });
      out += p.value;
      cursor = p.end;
    }
    out += text.slice(cursor);
    return { text: out, restored, unrestored, warnings, restoredSpans };
  }
}
