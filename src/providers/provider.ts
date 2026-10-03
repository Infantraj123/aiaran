export type AIRole = "system" | "user" | "assistant";

export type AIContentPart =
  { type: "text"; text: string } | { type: "image"; /** base64 */ data: string; mimeType: string };

export interface AIMessage {
  role: AIRole;
  content: string | AIContentPart[];
}

export interface AIRequest {
  messages: AIMessage[];
  /** System instructions (provider adapters map this to their native field). */
  system?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AIResponse {
  text: string;
  provider: string;
  model?: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** ARAN session the request was protected with (set by `Aran.generate`). */
  sessionId?: string;
}

export interface AIStreamChunk {
  text: string;
  done: boolean;
}

/**
 * Provider abstraction. V1 adapters are non-streaming; `stream` is reserved
 * so streaming support can be added without breaking the interface.
 */
export interface AIProvider {
  readonly name: string;
  generate(request: AIRequest): Promise<AIResponse>;
  stream?(request: AIRequest): AsyncIterable<AIStreamChunk>;
}

export function messageText(content: AIMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is Extract<AIContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
