import { describe, expect, it } from "vitest";
import {
  AnthropicProvider,
  GeminiProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
  OpenAIProvider,
  ProviderError,
  createProvider,
  type AIRequest,
} from "../../src/index.js";

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function mockFetch(response: unknown, status = 200): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const request: AIRequest = {
  system: "Be brief.",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Hi [PERSON_001]" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ],
    },
  ],
  maxTokens: 100,
};

describe("OpenAI-compatible providers", () => {
  it("maps requests and responses", async () => {
    const m = mockFetch({
      model: "m1",
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    });
    const p = new OpenAIProvider({ apiKey: "test-key", model: "m1", fetch: m.fetch });
    const r = await p.generate(request);
    expect(r).toEqual({
      text: "ok",
      provider: "openai",
      model: "m1",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 1 },
    });
    expect(m.calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect((m.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-key",
    );
    expect(m.calls[0]!.body).toMatchObject({
      model: "m1",
      max_tokens: 100,
      messages: [{ role: "system", content: "Be brief." }, { role: "user" }],
    });
    const parts = (m.calls[0]!.body.messages as { content: unknown }[])[1]!.content as {
      type: string;
    }[];
    expect(parts.map((x) => x.type)).toEqual(["text", "image_url"]);
    expect(m.calls[0]!.init.redirect).toBe("error");
  });

  it("supports custom base URLs and max_completion_tokens", async () => {
    const m = mockFetch({ choices: [{ message: { content: "ok" } }] });
    const p = new OpenAICompatibleProvider({
      baseURL: "http://localhost:8000/v1/",
      model: "local",
      maxTokensParam: "max_completion_tokens",
      fetch: m.fetch,
    });
    await p.generate({ messages: [{ role: "user", content: "x" }], maxTokens: 5 });
    expect(m.calls[0]!.url).toBe("http://localhost:8000/v1/chat/completions");
    expect(m.calls[0]!.body.max_completion_tokens).toBe(5);
  });

  it("requires a model and reports HTTP errors without request content", async () => {
    await expect(
      new OpenAICompatibleProvider({ baseURL: "http://x" }).generate(request),
    ).rejects.toThrow(/model is required/);
    const m = mockFetch({ error: { message: "invalid api key" } }, 401);
    const err = await new OpenAIProvider({ model: "m", fetch: m.fetch })
      .generate(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(401);
    expect((err as Error).message).toContain("invalid api key");
    expect((err as Error).message).not.toContain("PERSON_001");
  });
});

describe("Gemini and Ollama providers", () => {
  it("maps Gemini requests", async () => {
    const m = mockFetch({
      candidates: [{ content: { parts: [{ text: "o" }, { text: "k" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
    });
    const r = await new GeminiProvider({ apiKey: "g", model: "gemini-x", fetch: m.fetch }).generate(
      request,
    );
    expect(r.text).toBe("ok");
    expect(m.calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent",
    );
    expect((m.calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g");
    expect(m.calls[0]!.body).toMatchObject({
      systemInstruction: { parts: [{ text: "Be brief." }] },
      generationConfig: { maxOutputTokens: 100 },
    });
    await expect(
      new GeminiProvider({ apiKey: "g", fetch: m.fetch }).generate({
        ...request,
        model: "../evil",
      }),
    ).rejects.toThrow(ProviderError);
  });

  it("maps Ollama requests", async () => {
    const m = mockFetch({
      model: "llama",
      message: { content: "ok" },
      done_reason: "stop",
      prompt_eval_count: 4,
      eval_count: 2,
    });
    const r = await new OllamaProvider({ model: "llama", fetch: m.fetch }).generate(request);
    expect(r).toMatchObject({
      text: "ok",
      provider: "ollama",
      usage: { inputTokens: 4, outputTokens: 2 },
    });
    expect(m.calls[0]!.url).toBe("http://localhost:11434/api/chat");
    expect(m.calls[0]!.body).toMatchObject({ stream: false, options: { num_predict: 100 } });
    expect((m.calls[0]!.body.messages as { images?: string[] }[])[1]!.images).toEqual(["aGVsbG8="]);
  });
});

describe("Anthropic provider", () => {
  it("uses an injected SDK client and maps content blocks", async () => {
    const calls: unknown[] = [];
    const client = {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return {
            model: "claude-test",
            content: [
              { type: "text", text: "o" },
              { type: "text", text: "k" },
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 2 },
          };
        },
      },
    };
    const r = await new AnthropicProvider({ client, model: "claude-test" }).generate(request);
    expect(r).toEqual({
      text: "ok",
      provider: "anthropic",
      model: "claude-test",
      finishReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    expect(calls[0]).toMatchObject({
      model: "claude-test",
      max_tokens: 100,
      system: "Be brief.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
            },
          ],
        },
      ],
    });
    expect(calls[0]).not.toHaveProperty("temperature");
  });

  it("wraps SDK errors", async () => {
    const client = {
      messages: {
        create: async () =>
          Promise.reject(Object.assign(new Error("rate limited"), { status: 429 })),
      },
    };
    const err = await new AnthropicProvider({ client, model: "m" })
      .generate(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(429);
  });
});

describe("generic provider", () => {
  it("wraps functions", async () => {
    const p = createProvider("fn", async () => "hello");
    expect(await p.generate({ messages: [] })).toEqual({ text: "hello", provider: "fn" });
  });
});
