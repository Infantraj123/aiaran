import type { Entity } from "../entities/entity.js";
import type { EntityType } from "../entities/entity-types.js";
import type { DetectionInput, Detector } from "./detector.js";
import {
  GIVEN_NAMES,
  HINDI_NAME_STOPWORDS,
  NAME_STOPWORDS,
  TAMIL_NAME_STOPWORDS,
} from "./name-lists.js";
import { RegexDetector, type PatternRule } from "./regex-detector.js";

/**
 * Lightweight, local, rule-based named-entity heuristics for PERSON,
 * ADDRESS and HEALTHCARE_PROVIDER. This is intentionally not an ML model:
 * it favours precision on explicit cues ("Name:", "Mr.", "Patient …",
 * street suffixes, PIN/ZIP codes) and will miss names that appear without
 * any cue. Plug in a model-backed `NerDetector` for higher recall.
 */

/** Case-insensitive literal without the `i` flag (so name capitalisation can still be enforced). */
function ci(literal: string): string {
  return literal
    .split("")
    .map((ch) => {
      const lower = ch.toLowerCase();
      const upper = ch.toUpperCase();
      if (lower !== upper) return `[${lower}${upper}]`;
      if (ch === " ") return String.raw`\s+`;
      return ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    })
    .join("");
}

const NAME_WORD = String.raw`(?:\p{Lu}['’]\p{Lu}[\p{Ll}\p{M}]+|\p{Lu}\.|\p{Lu}[\p{Ll}\p{M}]+(?:['’\-]\p{Lu}?[\p{Ll}\p{M}]+)*|Mc\p{Lu}\p{Ll}+|Mac\p{Lu}\p{Ll}+)`;
const CAPS_WORD = String.raw`\p{Lu}{2,}(?:['’\-]\p{Lu}+)*`;
const NAME_SEQ = String.raw`${NAME_WORD}(?:[ \t]+${NAME_WORD}){0,3}`;
const NAME_SEQ_OR_CAPS = String.raw`(?:${NAME_WORD}|${CAPS_WORD})(?:[ \t]+(?:${NAME_WORD}|${CAPS_WORD})){0,3}`;

const TITLES = [
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "dr",
  "prof",
  "shri",
  "smt",
  "sri",
  "kumari",
  "thiru",
  "tmt",
  "selvi",
  "sir",
  "madam",
  "mme",
  "herr",
  "frau",
  "sr",
  "sra",
  "capt",
  "col",
  "adv",
];

const STRONG_LABELS = [
  "name",
  "full name",
  "patient name",
  "customer name",
  "employee name",
  "applicant name",
  "candidate name",
  "account holder",
  "account name",
  "beneficiary name",
  "father's name",
  "mother's name",
  "guardian name",
  "spouse name",
  "nominee",
  "contact person",
  "emergency contact",
  "signed by",
  "prepared by",
  "authored by",
  "attending physician",
  "referring physician",
  "consultant",
  "examined by",
  "reported by",
  "witness",
  "s/o",
  "d/o",
  "w/o",
  "c/o",
  "son of",
  "daughter of",
  "wife of",
  "husband of",
  "to",
  "from",
  "cc",
  "attn",
];

const WEAK_CUES = [
  "my name is",
  "name is",
  "named",
  "called",
  "i am",
  "i'm",
  "this is",
  "patient",
  "client",
  "customer",
  "employee",
  "applicant",
  "candidate",
  "tenant",
  "dear",
  "regards,",
  "sincerely,",
  "thanks,",
  "attn",
  "spoke with",
  "met with",
  "assigned to",
  "contact",
];

const INDIC_CUES_HI = [
  "मेरा नाम",
  "नाम",
  "श्री",
  "श्रीमती",
  "सुश्री",
  "कुमारी",
  "डॉ.",
  "डॉ",
  "मरीज़",
  "मरीज",
];
const INDIC_CUES_TA = [
  "என் பெயர்",
  "பெயர்",
  "திரு.",
  "திரு",
  "திருமதி",
  "செல்வி",
  "டாக்டர்",
  "மருத்துவர்",
  "நோயாளி",
];

const titleRe = new RegExp(
  String.raw`(?<![\p{L}])(?:${TITLES.map(ci).join("|")})\.?[ \t]+(${NAME_SEQ})`,
  "gdu",
);
const strongLabelRe = new RegExp(
  String.raw`(?<![\p{L}])(?:${STRONG_LABELS.map(ci).join("|")})[ \t]*[:\-–][ \t]*(${NAME_SEQ_OR_CAPS})`,
  "gdu",
);
const weakCueRe = new RegExp(
  String.raw`(?<![\p{L}])(?:${WEAK_CUES.map(ci).join("|")})[ \t]*:?[ \t]+(${NAME_SEQ})`,
  "gdu",
);
const capitalSeqRe = new RegExp(String.raw`(?<![\p{L}\p{N}_])(${NAME_SEQ})`, "gdu");
/** English labels followed by a name written in an Indic script ("Name: राहुल शर्मा"). */
const LATIN_LABELS_FOR_INDIC = String.raw`(?<![\p{L}])(?:${["patient name", "full name", "name", "mr", "mrs", "ms", "dr"].map(ci).join("|")})\.?(?=[ \t]*[:\-]?[ \t]*[\p{Script=Devanagari}\p{Script=Tamil}])`;

const hindiRe = new RegExp(
  String.raw`(?:${LATIN_LABELS_FOR_INDIC}|${INDIC_CUES_HI.map((c) => c.replace(/\./g, "\\.")).join("|")})[ \t]*[:\-]?[ \t]*((?:[\p{Script=Devanagari}\p{M}]+)(?:[ \t]+[\p{Script=Devanagari}\p{M}]+){0,2})`,
  "gdu",
);
const tamilRe = new RegExp(
  String.raw`(?:${LATIN_LABELS_FOR_INDIC}|${INDIC_CUES_TA.map((c) => c.replace(/\./g, "\\.")).join("|")})[ \t]*[:\-]?[ \t]*((?:[\p{Script=Tamil}\p{M}]+)(?:[ \t]+[\p{Script=Tamil}\p{M}]+){0,2})`,
  "gdu",
);

const STREET_SUFFIX = String.raw`(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Boulevard|Blvd|Drive|Court|Ct|Way|Place|Pl|Terrace|Nagar|Salai|Marg|Cross|Main\s+Road|Layout|Colony|Veedhi|Gali|Highway|Hwy|Parkway|Pkwy|Circle|Square|Sq|Extension|Extn|Sector|Phase|Enclave|Puram|Pettai|Palayam)`;
const NOT_LABEL = String.raw`(?!(?:Phone|Tel|Mobile|Email|E-mail|Ph|Mob|DOB|Age|Patient|PAN|Aadhaar|Passport|Account|Card)\b)`;
const ADDRESS_TAIL = String.raw`(?:,[ \t]*${NOT_LABEL}(?:[\p{Lu}\d][\p{L}\p{M}\d.'\-]*[ \t]?){1,4}){0,4}(?:[ \t,\-–]*(?:[1-9]\d{2}[ \t]?\d{3}|\d{5}(?:-\d{4})?)(?!\d))?`;

const ADDRESS_RULES: readonly PatternRule[] = [
  {
    type: "ADDRESS",
    id: "street-address",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])(?:(?:No\.?|Flat|Door|Plot|House|Apt\.?|Apartment|Unit|Suite)[ \t]*:?[ \t]*)?\d{1,5}[A-Za-z]?(?:[\/\-]\d{1,4}[A-Za-z]?)?,?[ \t]+(?:[\p{Lu}\d][\p{L}\p{M}\d.'\-]*,?[ \t]+){0,5}?${STREET_SUFFIX}\.?(?![\p{L}])${ADDRESS_TAIL}`,
      "u",
    ),
    confidence: 0.8,
    source: "ner",
  },
  {
    type: "ADDRESS",
    id: "labelled-address",
    pattern:
      /(?:(?<![\p{L}])(?:address|addr\.?|residential address|permanent address|mailing address|पता|முகவரி)[ \t]*(?::|-|–|is)|(?<![\p{L}])(?:residing at|resides at|lives at|living at|resident of))[ \t]*([^\n;]{6,160}?)(?=[ \t]*\.?[ \t]*(?:\n|;|$)|\.[ \t]|,?[ \t]*(?:phone|tel|mobile|email|e-mail|dob|ph|mob|age)\b)/iu,
    group: 1,
    confidence: 0.85,
    validate: (v) => /\d/.test(v) || (v.match(/,/g)?.length ?? 0) >= 1,
    source: "ner",
  },
  {
    type: "ADDRESS",
    id: "pin-labelled",
    pattern:
      /(?<![\p{L}])(?:pin\s?code|pincode|postal\s?code|zip\s?code|zip|pin|पिन\s?कोड|அஞ்சல்\s?குறியீடு)[ \t]*[:-]?[ \t]*([1-9]\d{2}[ \t]?\d{3}|\d{5}(?:-\d{4})?)(?!\d)/iu,
    group: 1,
    confidence: 0.75,
    source: "ner",
  },
  {
    type: "ADDRESS",
    id: "city-pin",
    pattern:
      /(?<![\p{L}])\p{Lu}[\p{Ll}]+(?:[ \t]\p{Lu}[\p{Ll}]+)?[ \t]*[-–,][ \t]*[1-9]\d{2}[ \t]?\d{3}(?!\d)/u,
    confidence: 0.7,
    source: "ner",
  },
  {
    type: "ADDRESS",
    id: "us-city-state-zip",
    pattern:
      /(?<![\p{L}])\p{Lu}[\p{Ll}]+(?:[ \t]\p{Lu}[\p{Ll}]+)?,[ \t]*[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?(?!\d)/u,
    confidence: 0.8,
    source: "ner",
  },
];

const providerRe = new RegExp(
  String.raw`(?<![\p{L}])((?:[\p{Lu}][\p{L}\p{M}'&.\-]+[ \t]+){1,5}(?:Hospitals?|Clinic|Medical[ \t]+Cent(?:er|re)|Health(?:care)?[ \t]+Cent(?:er|re)|Nursing[ \t]+Home|Diagnostics|Polyclinic|Dispensary|Medical[ \t]+College|Pharmacy|Laborator(?:y|ies)|Labs|Infirmary|Medical[ \t]+Group|Health[ \t]+System|Eye[ \t]+Care|Dental[ \t]+Care))(?![\p{L}])`,
  "gdu",
);
const providerIndicRe =
  /((?:[\p{Script=Devanagari}\p{M}]+[ \t]+){1,4}अस्पताल|(?:[\p{Script=Tamil}\p{M}]+[ \t]+){1,4}மருத்துவமனை)/dgu;

export class HeuristicNerDetector implements Detector {
  readonly name = "aran.ner-heuristic";
  readonly version = "1.0.0";
  readonly entityTypes: readonly EntityType[] = ["PERSON", "ADDRESS", "HEALTHCARE_PROVIDER"];
  private readonly addressDetector = new RegexDetector(
    "aran.ner-heuristic",
    "1.0.0",
    ADDRESS_RULES,
    "ner",
  );

  async detect(input: DetectionInput): Promise<Entity[]> {
    return this.detectSync(input.text);
  }

  detectSync(text: string): Entity[] {
    const out: Entity[] = [];
    this.persons(text, out);
    out.push(...this.addressDetector.detectSync(text));
    this.providers(text, out);
    return out;
  }

  private persons(text: string, out: Entity[]): void {
    const push = (start: number, end: number, confidence: number, rule: string): void => {
      out.push({
        id: "",
        type: "PERSON",
        start,
        end,
        confidence,
        source: "ner",
        detector: this.name,
        metadata: { rule },
      });
    };

    for (const m of matches(titleRe, text)) {
      const span = trimNameSpan(text, m.start, m.end);
      if (span) push(span.start, span.end, 0.88, "title");
    }
    for (const m of matches(strongLabelRe, text)) {
      const span = trimNameSpan(text, m.start, m.end, true);
      if (span) push(span.start, span.end, 0.9, "label");
    }
    for (const m of matches(weakCueRe, text)) {
      const span = trimNameSpan(text, m.start, m.end);
      if (!span) continue;
      const words = text.slice(span.start, span.end).split(/\s+/);
      const firstKnown = GIVEN_NAMES.has((words[0] ?? "").toLowerCase());
      if (words.length >= 2 || firstKnown)
        push(span.start, span.end, firstKnown ? 0.85 : 0.72, "cue");
    }
    for (const m of matches(capitalSeqRe, text)) {
      // A capitalised run may start with a non-name ("Call Ravi Kumar"): begin at the first known given name.
      const seq = text.slice(m.start, m.end);
      const wordRe = /\S+/g;
      let w: RegExpExecArray | null;
      let from = -1;
      while ((w = wordRe.exec(seq)) !== null) {
        if (GIVEN_NAMES.has(w[0].toLowerCase())) {
          from = w.index;
          break;
        }
      }
      if (from === -1) continue;
      const span = trimNameSpan(text, m.start + from, m.end);
      if (!span) continue;
      const words = text.slice(span.start, span.end).split(/\s+/);
      if (!GIVEN_NAMES.has((words[0] ?? "").toLowerCase())) continue;
      push(span.start, span.end, words.length >= 2 ? 0.75 : 0.58, "given-name");
    }
    const indic: [RegExp, ReadonlySet<string>, readonly string[]][] = [
      [hindiRe, HINDI_NAME_STOPWORDS, INDIC_CUES_HI],
      [tamilRe, TAMIL_NAME_STOPWORDS, INDIC_CUES_TA],
    ];
    for (const [re, stop, cues] of indic) {
      const isStop = (w: string): boolean => stop.has(w) || cues.includes(w);
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const idx = m.indices?.[1];
        if (!idx) continue;
        const words = text.slice(idx[0], idx[1]).split(/[ \t]+/);
        // Stacked cues ("मरीज़ का नाम: …", "நோயாளி பெயர்: …"): rescan from the captured cue word.
        if (isStop(words[0] ?? "")) {
          re.lastIndex = idx[0];
          continue;
        }
        while (words.length > 0 && isStop(words[words.length - 1] ?? "")) words.pop();
        if (words.length === 0) continue;
        push(idx[0], idx[0] + words.join(" ").length, 0.78, "indic-cue");
      }
    }
  }

  private providers(text: string, out: Entity[]): void {
    for (const m of [...matches(providerRe, text), ...matches(providerIndicRe, text)]) {
      let start = m.start;
      const value = text.slice(m.start, m.end);
      const words = value.split(/[ \t]+/);
      // Drop leading stopwords such as "The" or "At".
      while (
        words.length > 2 &&
        NAME_STOPWORDS.has((words[0] ?? "").toLowerCase().replace(/\.$/, ""))
      ) {
        start += (words.shift() ?? "").length;
        while (/[ \t]/.test(text[start] ?? "")) start++;
      }
      out.push({
        id: "",
        type: "HEALTHCARE_PROVIDER",
        start,
        end: m.end,
        confidence: 0.75,
        source: "ner",
        detector: this.name,
        metadata: { rule: "provider" },
      });
    }
  }
}

function* matches(re: RegExp, text: string): Generator<{ start: number; end: number }> {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const idx = m.indices?.[1] ?? m.indices?.[0];
    if (idx) yield { start: idx[0], end: idx[1] };
  }
}

/** Remove stopwords at either end of a candidate name; reject if nothing plausible remains. */
function trimNameSpan(
  text: string,
  start: number,
  end: number,
  allowCaps = false,
): { start: number; end: number } | undefined {
  const value = text.slice(start, end);
  const tokens: { word: string; offset: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) tokens.push({ word: m[0], offset: m.index });
  const isStop = (w: string): boolean => NAME_STOPWORDS.has(w.toLowerCase().replace(/[.,]$/, ""));
  while (tokens.length > 0 && isStop(tokens[0]!.word)) tokens.shift();
  while (tokens.length > 0 && isStop(tokens[tokens.length - 1]!.word)) tokens.pop();
  if (tokens.length === 0) return undefined;
  // Cut at the first stopword inside the sequence ("John And" → "John").
  const cut = tokens.findIndex((t) => isStop(t.word));
  const kept = cut === -1 ? tokens : tokens.slice(0, cut);
  if (kept.length === 0) return undefined;
  const first = kept[0]!;
  const last = kept[kept.length - 1]!;
  // A lone initial ("A.") is not a name.
  if (kept.length === 1 && /^\p{Lu}\.$/u.test(first.word)) return undefined;
  if (!allowCaps && kept.every((t) => /^\p{Lu}{2,}$/u.test(t.word))) return undefined;
  return { start: start + first.offset, end: start + last.offset + last.word.length };
}
