import type { BoundingBox } from "../../entities/entity-types.js";

/**
 * Optional face detector. ARAN does not ship a face model; plug in a local
 * implementation to have faces redacted. Without one, images are reported
 * with a FACES_NOT_INSPECTED notice.
 */
export interface FaceDetector {
  readonly name: string;
  readonly version: string;
  detect(image: Buffer): Promise<{ box: BoundingBox; confidence: number }[]>;
}
