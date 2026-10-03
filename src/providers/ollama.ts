import { postJson, requireValue, type HttpOptions } from "./http.js";
import { messageText, type AIProvider, type AIRequest, type AIResponse } from "./provider.js";

export interface OllamaOptions extends HttpOptions {
  /** Default http://localhost:11434 */
  baseURL?: string;
  model?: string;
}

/** Adapter for a local Ollama server (/api/chat). Data stays on your machine. */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  constructor(private readonly options: OllamaOptions = {}) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const baseURL = (this.options.baseURL ?? "http://localhost:11434").replace(/\/+$/, "");
    const model = requireValue(request.model ?? this.options.model, this.name, "model");
    const messages = [
      ...(request.system ? [{ role: "system", content: request.system }] : []),
      ...request.messages.map((m) => {
        const images =
          typeof m.content === "string"
            ? []
            : m.content.filter((p) => p.type === "image").map((p) => p.data);
        return {
          role: m.role,
          content: messageText(m.content),
          ...(images.length ? { images } : {}),
        };
      }),
    ];
    const json = (await postJson(
      this.name,
      `${baseURL}/api/chat`,
      {},
      {
        model,
        messages,
        stream: false,
        options: {
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
        },
      },
      { ...this.options, ...(request.signal ? { signal: request.signal } : {}) },
    )) as {
      model?: string;
      message?: { content?: string };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      text: json.message?.content ?? "",
      provider: this.name,
      ...(json.model ? { model: json.model } : {}),
      ...(json.done_reason ? { finishReason: json.done_reason } : {}),
      usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 },
    };
  }
}
