import { describe, expect, it } from "vitest";
import { HeuristicNerDetector } from "../../src/detection/ner-detector.js";
import { found } from "../helpers/detect.js";

const ner = new HeuristicNerDetector();
const people = async (text: string): Promise<string[]> =>
  (await found(ner, text)).filter((f) => f.startsWith("PERSON="));

describe("heuristic NER — persons", () => {
  it("detects names after titles", async () => {
    expect(await people("Seen by Dr. Priya Raman today")).toContain("PERSON=Priya Raman");
    expect(await people("Mr. John O'Brien called")).toContain("PERSON=John O'Brien");
    expect(await people("Smt. Lakshmi Devi visited")).toContain("PERSON=Lakshmi Devi");
  });

  it("detects names after labels, including all-caps", async () => {
    expect(await people("Name: ARJUN MEHTA\nAge: 40")).toContain("PERSON=ARJUN MEHTA");
    expect(await people("Patient name: Emily Carter")).toContain("PERSON=Emily Carter");
  });

  it("detects names after weak cues only with supporting evidence", async () => {
    expect(await people("My name is John and I need help")).toContain("PERSON=John");
    expect(await people("Patient John Smith presented")).toContain("PERSON=John Smith");
    expect(await people("I am Happy to help")).toEqual([]);
    expect(await people("This is Important")).toEqual([]);
  });

  it("detects known given names with surnames", async () => {
    expect(await people("Please ask Priyanka Sharma to sign")).toContain("PERSON=Priyanka Sharma");
  });

  it("does not flag ordinary capitalised words", async () => {
    expect(await people("The Quarterly Report was approved on Monday by the Board.")).toEqual([]);
  });

  it("detects Hindi and Tamil names after cues", async () => {
    expect(await people("मेरा नाम राहुल शर्मा है।")).toContain("PERSON=राहुल शर्मा");
    expect(await people("मरीज़ का नाम: अनीता वर्मा")).toContain("PERSON=अनीता वर्मा");
    expect(await people("என் பெயர் ராஜேஷ் குமார்.")).toContain("PERSON=ராஜேஷ் குமார்");
    expect(await people("நோயாளி பெயர்: மீனா சுந்தரம்,")).toContain("PERSON=மீனா சுந்தரம்");
  });
});

describe("heuristic NER — addresses and providers", () => {
  it("detects street addresses with Indian and US forms", async () => {
    const r1 = await found(ner, "Lives at 12 MG Road, Chennai - 600001.");
    expect(r1.some((r) => r.startsWith("ADDRESS=12 MG Road, Chennai - 600001"))).toBe(true);
    const r2 = await found(ner, "Ship to 742 Evergreen Terrace, Springfield, IL 62704");
    expect(r2.some((r) => r.startsWith("ADDRESS=742 Evergreen Terrace"))).toBe(true);
  });

  it("detects labelled addresses without swallowing trailing punctuation", async () => {
    const r = await found(ner, "Address: Flat 4B, Lotus Apartments, Pune 411001.\nPhone: x");
    expect(r).toContain("ADDRESS=Flat 4B, Lotus Apartments, Pune 411001");
  });

  it("does not treat 'address' used as a verb as an address", async () => {
    expect(
      (await found(ner, "We will address the issue tomorrow")).filter((f) =>
        f.startsWith("ADDRESS"),
      ),
    ).toEqual([]);
  });

  it("detects healthcare providers", async () => {
    expect(await found(ner, "admitted to Lotus Valley Hospital yesterday")).toContain(
      "HEALTHCARE_PROVIDER=Lotus Valley Hospital",
    );
    expect(await found(ner, "The Sunrise Eye Care clinic")).toContain(
      "HEALTHCARE_PROVIDER=Sunrise Eye Care",
    );
  });
});

describe("heuristic NER — regressions", () => {
  it("finds a known given name after a capitalised verb", async () => {
    expect(await people("Call Ravi Kumar on Monday")).toContain("PERSON=Ravi Kumar");
    expect(await people("Thanks Priya for the update")).toContain("PERSON=Priya");
  });
});

describe("heuristic NER — mixed script", () => {
  it("detects Indic-script names after English labels", async () => {
    expect(await people("Name: राहुल शर्मा, email x")).toContain("PERSON=राहुल शर्मा");
    expect(await people("Patient name - மீனா சுந்தரம்")).toContain("PERSON=மீனா சுந்தரம்");
    expect(await people("username: राहुल")).toEqual([]);
  });
});
