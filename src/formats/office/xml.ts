/** Minimal XML text helpers for WordprocessingML (text nodes contain no markup). */

export function decodeXml(s: string): string {
  return s.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (match, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (dec !== undefined) return safeFromCodePoint(Number(dec), match);
      if (hex !== undefined) return safeFromCodePoint(parseInt(hex, 16), match);
      switch (named) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return match;
      }
    },
  );
}

function safeFromCodePoint(cp: number, fallback: string): string {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return fallback;
  return String.fromCodePoint(cp);
}

export function encodeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function encodeXmlAttr(s: string): string {
  return encodeXmlText(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
