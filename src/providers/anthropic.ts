import type Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../core/errors.js";
import { optionalImport } from "../core/optional.js";
import { requireValue } from "./http.js";
import type { AIMessage, AIProvider, AIRequest, AIResponse } from "./provider.js";

export interface AnthropicProviderOptions {
  /** Defaults to the SDK's own credential resolution (ANTHROPIC_API_KEY, etc.). */
  apiKey?: string;
  /** Default model (required unless passed per request), e.g. "claude-opus-5-5". */
  model?: string;
  /** Default max_tokens (default 16000). */
  maxTokens?: number;
  baseURL?: string;
  timeoutMs?: number;
  /** Pre-configured `Anthropic` client instance (e.g. with custom retries). */
  client?: unknown;
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/**
 * Adapter for the Anthropic Messages API using the official
 * `@anthropic-ai/sdk` package (optional peer dependency).
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Promise<Anthropic> | undefined;

  constructor(private readonly options: AnthropicProviderOptions = {}) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const client = await this.getClient();
    const model = requireValue(request.model ?? this.options.model, this.name, "model");
    const system = [
      request.system,
      ...request.messages
        .filter((m) => m.role === "system")
        .map((m) => (typeof m.content === "string" ? m.content : "")),
    ]
      .filter(Boolean)
      .join("\n\n");
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: request.maxTokens ?? this.options.maxTokens ?? 16000,
      messages: request.messages.filter((m) => m.role !== "system").map(toAnthropicMessage),
      ...(system ? { system } : {}),
      // Only sent when explicitly requested: some current models reject sampling parameters.
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        params,
        request.signal ? { signal: request.signal } : undefined,
      );
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      throw new ProviderError(
        `anthropic request failed${typeof status === "number" ? ` (HTTP ${status})` : ""}.`,
        {
          cause: error,
          ...(typeof status === "number" ? { status } : {}),
        },
      );
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      provider: this.name,
      model: response.model,
      ...(response.stop_reason ? { finishReason: response.stop_reason } : {}),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private getClient(): Promise<Anthropic> {
    if (this.options.client) return Promise.resolve(this.options.client as Anthropic);
    this.client ??= optionalImport<{ default: typeof Anthropic }>(
      "@anthropic-ai/sdk",
      "the Anthropic provider",
    ).then((mod) => {
      const Ctor = mod.default;
      return new Ctor({
        ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
        ...(this.options.baseURL ? { baseURL: this.options.baseURL } : {}),
        ...(this.options.timeoutMs ? { timeout: this.options.timeoutMs } : {}),
      });
    });
    return this.client;
  }
}

function toAnthropicMessage(m: AIMessage): Anthropic.MessageParam {
  const role = m.role === "assistant" ? "assistant" : "user";
  if (typeof m.content === "string") return { role, content: m.content };
  return {
    role,
    content: m.content.map((p): Anthropic.ContentBlockParam =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : {
            type: "image",
            source: { type: "base64", media_type: p.mimeType as ImageMediaType, data: p.data },
          },
    ),
  };
}
