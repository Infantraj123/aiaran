import type { Detector } from "../../src/detection/detector.js";

/** Run a detector and return `TYPE=value` strings for readable assertions. */
export async function found(
  detector: Detector,
  text: string,
  minConfidence = 0.5,
): Promise<string[]> {
  const entities = await detector.detect({ text });
  return entities
    .filter((e) => e.confidence >= minConfidence)
    .map((e) => `${e.type}=${text.slice(e.start ?? 0, e.end ?? 0)}`);
}
