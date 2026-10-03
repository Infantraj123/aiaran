import type { AIProvider, AIRequest, AIResponse } from "./provider.js";

/** Wrap any function as an AIProvider (custom SDKs, internal gateways, test doubles). */
export function createProvider(
  name: string,
  generate: (request: AIRequest) => Promise<string | AIResponse>,
): AIProvider {
  return {
    name,
    async generate(request: AIRequest): Promise<AIResponse> {
      const result = await generate(request);
      return typeof result === "string"
        ? { text: result, provider: name }
        : { ...result, provider: result.provider ?? name };
    },
  };
}

export const PROVIDERS = [
  {
    name: "openai",
    adapter: "OpenAIProvider",
    dependency: "none (fetch)",
    description: "OpenAI Chat Completions API",
  },
  {
    name: "openai-compatible",
    adapter: "OpenAICompatibleProvider",
    dependency: "none (fetch)",
    description:
      "Any OpenAI-compatible server (vLLM, LM Studio, LiteLLM, Azure-compatible gateways)",
  },
  {
    name: "anthropic",
    adapter: "AnthropicProvider",
    dependency: "@anthropic-ai/sdk (optional peer)",
    description: "Anthropic Messages API",
  },
  {
    name: "gemini",
    adapter: "GeminiProvider",
    dependency: "none (fetch)",
    description: "Google Gemini generateContent API",
  },
  {
    name: "ollama",
    adapter: "OllamaProvider",
    dependency: "none (fetch)",
    description: "Local Ollama server",
  },
  {
    name: "custom",
    adapter: "createProvider()",
    dependency: "none",
    description: "Wrap your own function",
  },
] as const;
