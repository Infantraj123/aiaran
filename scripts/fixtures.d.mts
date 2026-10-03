export declare const SYNTHETIC: {
  name: string;
  email: string;
  phone: string;
  aadhaar: string;
  pan: string;
  patientId: string;
  card: string;
  apiKey: string;
};
export declare function makeImage(
  lines: string[],
  options?: { width?: number; fontSize?: number },
): Promise<Buffer>;
export declare function makeTextPdf(pages: string[][]): Promise<Buffer>;
export declare function makeScannedPdf(lines: string[]): Promise<Buffer>;
export declare function makeDocx(options?: {
  paragraphs?: (string | string[])[];
  table?: string[][];
  header?: string;
  hyperlinkEmail?: string;
  deletedText?: string;
  author?: string;
  extraEntries?: Record<string, Uint8Array>;
}): Buffer;
