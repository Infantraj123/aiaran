import { ProviderError } from "../core/errors.js";
import { postJson, requireValue, type HttpOptions } from "./http.js";
import type { AIMessage, AIProvider, AIRequest, AIResponse } from "./provider.js";

export interface OpenAICompatibleOptions extends HttpOptions {
  /** API key. Defaults to OPENAI_API_KEY for the OpenAI provider; optional for local servers. */
  apiKey?: string;
  /** Base URL, e.g. https://api.openai.com/v1 or http://localhost:8000/v1. */
  baseURL?: string;
  /** Default model (required unless passed per request). */
  model?: string;
  /** Some newer models require `max_completion_tokens` instead of `max_tokens`. */
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  headers?: Record<string, string>;
  /** Display name used in logs and errors. */
  name?: string;
}

/** Adapter for the OpenAI Chat Completions API and compatible servers (vLLM, LM Studio, LiteLLM, …). */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;

  constructor(private readonly options: OpenAICompatibleOptions = {}) {
    this.name = options.name ?? "openai-compatible";
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const baseURL = requireValue(this.options.baseURL, this.name, "baseURL").replace(/\/+$/, "");
    const model = requireValue(request.model ?? this.options.model, this.name, "model");
    const messages = [
      ...(request.system ? [{ role: "system", content: request.system }] : []),
      ...request.messages.map(toOpenAIMessage),
    ];
    const body: Record<string, unknown> = { model, messages };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined)
      body[this.options.maxTokensParam ?? "max_tokens"] = request.maxTokens;

    const json = (await postJson(
      this.name,
      `${baseURL}/chat/completions`,
      {
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        ...this.options.headers,
      },
      body,
      { ...this.options, ...(request.signal ? { signal: request.signal } : {}) },
    )) as {
      model?: string;
      choices?: { message?: { content?: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    if (!choice) throw new ProviderError(`${this.name} returned no choices.`);
    return {
      text: choice.message?.content ?? "",
      provider: this.name,
      ...(json.model ? { model: json.model } : {}),
      ...(choice.finish_reason ? { finishReason: choice.finish_reason } : {}),
      ...(json.usage
        ? {
            usage: {
              inputTokens: json.usage.prompt_tokens ?? 0,
              outputTokens: json.usage.completion_tokens ?? 0,
            },
          }
        : {}),
    };
  }
}

/** OpenAI (api.openai.com). Reads OPENAI_API_KEY when no key is given. */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(options: OpenAICompatibleOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    super({
      ...options,
      name: options.name ?? "openai",
      baseURL: options.baseURL ?? "https://api.openai.com/v1",
      ...(apiKey ? { apiKey } : {}),
    });
  }
}

function toOpenAIMessage(m: AIMessage): Record<string, unknown> {
  if (typeof m.content === "string") return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: m.content.map((p) =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` } },
    ),
  };
}
