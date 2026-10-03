export type InputType = "text" | "image" | "pdf" | "docx";

/** Binary input accepted for files. */
export type BinaryData = Buffer | Uint8Array | ArrayBuffer;

/** Content mode returns sanitized text; document mode also returns a sanitized file. */
export type DocumentMode = "content" | "document";

interface BaseInput {
  /**
   * Purpose of the AI request (e.g. "summarize medical condition"). Used by
   * purpose-based minimization rules in the active policy.
   */
  purpose?: string;
  /** BCP-47 language hint such as "en", "hi" or "ta". Auto-detected by script when omitted. */
  language?: string;
  /**
   * Reuse an existing session so the same values map to the same tokens across
   * multiple requests (e.g. multi-turn chat). A new session is created when omitted.
   */
  sessionId?: string;
}

export interface TextInput extends BaseInput {
  type: "text";
  /** A string, or a JSON-compatible object/array whose string values are protected. */
  data: string | Record<string, unknown> | unknown[];
}

interface FileInputBase extends BaseInput {
  data: BinaryData;
  /** Original file name. Only the extension is used, for validation. */
  filename?: string;
  /** Declared MIME type. Validated against the file's magic bytes. */
  mimeType?: string;
}

export interface ImageInput extends FileInputBase {
  type: "image";
}

export interface PdfInput extends FileInputBase {
  type: "pdf";
  mode?: DocumentMode;
}

export interface DocxInput extends FileInputBase {
  type: "docx";
  mode?: DocumentMode;
}

export type ProtectInput = TextInput | ImageInput | PdfInput | DocxInput;
