export interface Replacement {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Apply non-overlapping replacements to text. Replacements are applied in
 * a single pass, so earlier replacements never shift later offsets.
 */
export function applyReplacements(text: string, replacements: readonly Replacement[]): string {
  if (replacements.length === 0) return text;
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const r of sorted) {
    if (r.start < cursor) continue; // overlapping replacement — already covered
    out += text.slice(cursor, r.start) + r.replacement;
    cursor = r.end;
  }
  return out + text.slice(cursor);
}
