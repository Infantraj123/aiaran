import { ProviderError } from "../core/errors.js";
import { postJson, requireValue, type HttpOptions } from "./http.js";
import type { AIProvider, AIRequest, AIResponse } from "./provider.js";

export interface GeminiOptions extends HttpOptions {
  /** Defaults to GEMINI_API_KEY or GOOGLE_API_KEY. */
  apiKey?: string;
  model?: string;
  /** Default https://generativelanguage.googleapis.com/v1beta */
  baseURL?: string;
}

/** Adapter for the Google Gemini generateContent API. */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  constructor(private readonly options: GeminiOptions = {}) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const apiKey = requireValue(
      this.options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
      this.name,
      "apiKey",
    );
    const model = requireValue(request.model ?? this.options.model, this.name, "model");
    if (!/^[\w.-]+$/.test(model)) throw new ProviderError("gemini: invalid model name.");
    const baseURL = (
      this.options.baseURL ?? "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");

    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts:
          typeof m.content === "string"
            ? [{ text: m.content }]
            : m.content.map((p) =>
                p.type === "text"
                  ? { text: p.text }
                  : { inline_data: { mime_type: p.mimeType, data: p.data } },
              ),
      }));
    const systemText = [
      request.system,
      ...request.messages
        .filter((m) => m.role === "system")
        .map((m) => (typeof m.content === "string" ? m.content : "")),
    ]
      .filter(Boolean)
      .join("\n\n");

    const json = (await postJson(
      this.name,
      `${baseURL}/models/${model}:generateContent`,
      { "x-goog-api-key": apiKey },
      {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        generationConfig: {
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
        },
      },
      { ...this.options, ...(request.signal ? { signal: request.signal } : {}) },
    )) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      modelVersion?: string;
    };
    const candidate = json.candidates?.[0];
    if (!candidate) throw new ProviderError("gemini returned no candidates.");
    return {
      text: (candidate.content?.parts ?? []).map((p) => p.text ?? "").join(""),
      provider: this.name,
      model: json.modelVersion ?? model,
      ...(candidate.finishReason ? { finishReason: candidate.finishReason } : {}),
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
