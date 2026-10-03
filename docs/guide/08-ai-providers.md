# 8. Using ARAN with AI providers

Demos: [`demos/07-ai-providers.ts`](../../demos/07-ai-providers.ts) (works offline with a mock model, or with a real provider) · [`demos/10-web-server.ts`](../../demos/10-web-server.ts)

- [8.1 Two ways to integrate](#81-two-ways-to-integrate)
- [8.2 `generate()`: step by step](#82-generate-step-by-step)
- [8.3 Provider setup](#83-provider-setup) (OpenAI · Anthropic · Gemini · Ollama · OpenAI-compatible · your own)
- [8.4 Manual integration (your own SDK calls)](#84-manual-integration-your-own-sdk-calls)
- [8.5 Files: images, PDFs and DOCX with AI](#85-files-images-pdfs-and-docx-with-ai)
- [8.6 In a web API (Express, Fastify, Next.js, node:http)](#86-in-a-web-api)
- [8.7 Error handling](#87-error-handling)
- [8.8 Streaming](#88-streaming)

---

## 8.1 Two ways to integrate

|                                          | `aran.generate(provider, input)`                 | Manual: `protect()` → your SDK → `release()` |
| ---------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| Code                                     | one call                                         | three steps                                  |
| Checks status for you                    | yes: never sends blocked or fail-closed requests | you check `status` yourself                  |
| Adds the "keep placeholders" instruction | yes                                              | add it yourself                              |
| Works with                               | ARAN's provider adapters or any function         | any SDK, agent framework or tool calling     |

## 8.2 `generate()`: step by step

```ts
import { Aran, OpenAIProvider } from "aiaran";

// 1. one Aran and one provider for your whole app
const aran = new Aran({ policy: "healthcare" });
const provider = new OpenAIProvider({ model: "gpt-4o-mini" }); // reads OPENAI_API_KEY

// 2. call
const { text, protection, release, response } = await aran.generate(
  provider,
  { type: "text", data: note, purpose: "patient communication: summarise the visit" },
  { system: "You write short clinical visit summaries.", maxTokens: 300 },
);

// 3. use the answer
console.log(text); // restored text, or null if the output policy blocked it
```

What happens inside `generate()`:

1. `protect(input)`. If `status` is `blocked`, it throws `BlockedError`. If `safeData` is `null` (fail-closed), it throws `SecurityError`. **The provider is never called in either case.**
2. It builds the request from `safeData` and adds the placeholder instruction to `system`.
3. It calls `provider.generate(request)`.
4. It calls `release(answer, sessionId)` to scan the answer and restore tokens.

Real run from demo 7 (mock model). **What the model received:**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Patient [PERSON_001], patient ID [PATIENT_ID_001], age 52.\nPhone [PHONE_REDACTED], email [EMAIL_REDACTED].\nBP 150/95, LDL 190 mg/dL, started atorvastatin. Seen by Dr. [PERSON_002]."
    }
  ],
  "system": "You write short clinical visit summaries.\n\nSome values in the user content were replaced with placeholders such as [PERSON_001] or [EMAIL_REDACTED]. Treat each placeholder as an opaque value and reproduce placeholders exactly as written when you refer to them.",
  "maxTokens": 300
}
```

**What your app gets back:**

```text
Summary for John Smith: hypertension (150/95), age 52, on atorvastatin. Follow up with Priya Raman in 2 weeks.

restored tokens: 2 | output warnings: []
```

`generate()` options:

| Option                     | Meaning                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `model`                    | override the provider's default model for this call                                |
| `system`                   | system instructions (written by you; **not scanned**, so don't put user data here) |
| `temperature`, `maxTokens` | passed to the provider (only if you set them)                                      |
| `tokenHint`                | `false` to skip the automatic placeholder instruction                              |
| `allowUncertain`           | `false` to refuse `uncertain` results even in fail-open mode                       |
| `signal`                   | an `AbortSignal` to cancel the request                                             |

Return value: `{ text, protection: ProtectionResult, release: ReleaseResult, response: { provider, model?, finishReason?, usage? } }`.

## 8.3 Provider setup

No provider package is required except the Anthropic SDK. Model names are always yours to choose; ARAN doesn't hard-code any.

### OpenAI

```ts
import { OpenAIProvider } from "aiaran";

const provider = new OpenAIProvider({
  model: "gpt-4o-mini", // any chat model
  // apiKey: "...",            // default: process.env.OPENAI_API_KEY
  // maxTokensParam: "max_completion_tokens", // for models that require it
  // timeoutMs: 120_000,
});
```

```bash
export OPENAI_API_KEY=sk-...
AI_PROVIDER=openai AI_MODEL=gpt-4o-mini node demos/07-ai-providers.ts
```

### Anthropic (Claude)

```bash
npm install @anthropic-ai/sdk
export ANTHROPIC_API_KEY=...
```

```ts
import { AnthropicProvider } from "aiaran";

const provider = new AnthropicProvider({
  model: "claude-opus-5-5",
  // maxTokens: 16000,        // default max_tokens
  // apiKey / baseURL / timeoutMs, or client: an existing Anthropic SDK client
});
```

```bash
AI_PROVIDER=anthropic AI_MODEL=claude-opus-5-5 node demos/07-ai-providers.ts
```

Some current Claude models reject sampling parameters, so ARAN sends `temperature` only when you set it.

### Google Gemini

```ts
import { GeminiProvider } from "aiaran";

const provider = new GeminiProvider({ model: "gemini-2.5-flash" }); // any Gemini model; key from GEMINI_API_KEY or GOOGLE_API_KEY
```

### Ollama (fully local: nothing leaves your machine)

```bash
ollama pull llama3.2
```

```ts
import { OllamaProvider } from "aiaran";

const provider = new OllamaProvider({ model: "llama3.2" /* baseURL: "http://localhost:11434" */ });
```

```bash
AI_PROVIDER=ollama AI_MODEL=llama3.2 node demos/07-ai-providers.ts
```

### Any OpenAI-compatible server (vLLM, LM Studio, LiteLLM, Azure gateways, OpenRouter, …)

```ts
import { OpenAICompatibleProvider } from "aiaran";

const provider = new OpenAICompatibleProvider({
  baseURL: "http://localhost:8000/v1",
  model: "my-model",
  apiKey: "gateway-key", // optional
  headers: { "x-tenant": "clinic-42" }, // optional extra headers
  name: "internal-gateway", // shown in logs
});
```

### Your own client, an internal gateway, or a test double

```ts
import { createProvider } from "aiaran";

const provider = createProvider("my-gateway", async (request) => {
  // request: { messages, system?, model?, temperature?, maxTokens?, signal? }
  const res = await myHttpClient.post("/llm", request);
  return res.text; // or { text, model, usage, finishReason }
});
```

Run `npx aran providers list` to see all adapters.

## 8.4 Manual integration (your own SDK calls)

Use this when you already use an SDK, an agent framework, or tool calling.

```ts
import OpenAI from "openai";
import { Aran } from "aiaran";

const aran = new Aran({ policy: "default" });
const openai = new OpenAI();

const PLACEHOLDER_HINT =
  "Some values were replaced with placeholders such as [PERSON_001] or [EMAIL_REDACTED]. " +
  "Reproduce placeholders exactly as written.";

export async function ask(userText: string, sessionId?: string) {
  // 1. protect
  const p = await aran.protect({
    type: "text",
    data: userText,
    ...(sessionId ? { sessionId } : {}),
  });
  if (p.status === "blocked") throw new Error(`Not allowed: ${p.minimization.blocked.join(", ")}`);
  if (p.safeData === null) throw new Error("Could not fully inspect the input.");

  // 2. call the model with safeData only
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: PLACEHOLDER_HINT },
      { role: "user", content: p.safeData as string },
    ],
  });
  const answer = completion.choices[0]?.message.content ?? "";

  // 3. release
  const r = await aran.release(answer, p.sessionId);
  return { text: r.data, sessionId: p.sessionId, warnings: r.warnings };
}
```

Demo 7 step 4 does exactly this with a fake reply:

```text
Hi Ravi Kumar, this is a reminder about your appointment tomorrow at 10am.
```

**Tool / function calling:** run `release()` (or `scan()`) on tool arguments that leave your system, and `protect()` (with the same `sessionId`) on tool results before giving them to the model.

## 8.5 Files: images, PDFs and DOCX with AI

`generate()` accepts every input type:

| Input                   | What is sent to the model                                         |
| ----------------------- | ----------------------------------------------------------------- |
| `type: "text"` (string) | the protected string                                              |
| `type: "text"` (object) | the protected object as pretty-printed JSON                       |
| `type: "image"`         | the **redacted PNG** + "Text visible in the image (sanitized): …" |
| `type: "pdf"`           | the sanitized text of all pages                                   |
| `type: "docx"`          | the sanitized text                                                |

```ts
const { text } = await aran.generate(provider, {
  type: "pdf",
  data: await readFile("discharge-summary.pdf"),
  purpose: "summarize medical condition",
});
```

## 8.6 In a web API

Create **one** `Aran` instance when the server starts. Never create one per request.

### node:http (demo 10)

```bash
node demos/10-web-server.ts
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"I am Ravi Kumar, email ravi.kumar@example.com. Summarise my plan."}'
```

Real results:

```text
200 {"reply":"Hi Ravi Kumar, here is your plan summary. I'll send a copy to ravi.kumar@example.com.","risk":"MEDIUM"}
422 {"error":"Request blocked by policy; nothing was sent to the AI provider."}
```

The second request contained a password and a GitHub token, and the `enterprise` policy blocked it before any model call.

### Express

```ts
import express from "express";
import { Aran, AranError, BlockedError, OpenAIProvider } from "aiaran";

const app = express();
app.use(express.json({ limit: "1mb" }));

const aran = new Aran({ policy: "enterprise" });
const provider = new OpenAIProvider({ model: "gpt-4o-mini" });

app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body as { message: string; sessionId?: string };
    const result = await aran.generate(provider, {
      type: "text",
      data: message,
      ...(sessionId ? { sessionId } : {}),
    });
    res.json({ reply: result.text, sessionId: result.protection.sessionId });
  } catch (error) {
    if (error instanceof BlockedError) return res.status(422).json({ error: error.message });
    if (error instanceof AranError) return res.status(400).json({ error: error.message }); // safe: no user data in messages
    res.status(500).json({ error: "Internal error" });
  }
});

const server = app.listen(3000);
process.on("SIGTERM", async () => {
  server.close();
  await aran.dispose();
});
```

### File uploads (Express + multer)

```ts
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file!;
  const type =
    file.mimetype === "application/pdf"
      ? "pdf"
      : file.originalname.toLowerCase().endsWith(".docx")
        ? "docx"
        : "image";
  const result = await aran.protect({
    type,
    data: file.buffer,
    filename: file.originalname,
    mimeType: file.mimetype,
  });
  if (result.safeData === null)
    return res
      .status(422)
      .json({ status: result.status, warnings: result.warnings.map((w) => w.code) });
  res.json({
    status: result.status,
    summary: result.summary,
    text:
      "text" in (result.safeData as object)
        ? (result.safeData as { text: string }).text
        : undefined,
  });
});
```

ARAN checks the real file format, so a renamed file is rejected even if `mimetype` or `originalname` lies.

### Next.js (route handler)

```ts
// app/api/chat/route.ts
import { Aran, OpenAIProvider } from "aiaran";

export const runtime = "nodejs"; // ARAN needs Node.js, not the Edge runtime

const g = globalThis as unknown as { aran?: Aran };
const aran = (g.aran ??= new Aran({ policy: "default" })); // reuse across hot reloads
const provider = new OpenAIProvider({ model: "gpt-4o-mini" });

export async function POST(req: Request) {
  const { message } = (await req.json()) as { message: string };
  const result = await aran.generate(provider, { type: "text", data: message });
  return Response.json({ reply: result.text });
}
```

For Next.js, add `serverExternalPackages: ["aiaran", "sharp", "tesseract.js", "pdfjs-dist"]` to `next.config.js` so these packages are not bundled.

## 8.7 Error handling

| Error                                            | When                                                            | What to do                                                           |
| ------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `BlockedError`                                   | the policy blocked the input (`generate`) or output (`restore`) | tell the user which **type** of data isn't allowed (`error.details`) |
| `SecurityError`                                  | fail-closed and not fully inspected; size limits                | ask for a clearer or smaller input                                   |
| `ProviderError`                                  | the AI API failed (`error.status` = HTTP status)                | retry on 429 and 5xx                                                 |
| `DependencyMissingError`                         | optional package missing                                        | install it (`error.dependency`)                                      |
| `InputValidationError`, `UnsupportedFormatError` | bad input or file type                                          | return 400                                                           |
| `TimeoutError`                                   | processing exceeded `limits.timeoutMs`                          | raise the limit or reduce the input                                  |

All of them extend `AranError` and have a `code`. **Messages never contain user data**, so they are safe to log and to return to clients.

## 8.8 Streaming

V1 adapters are non-streaming. The `AIProvider` interface reserves a `stream()` method for a future version. If you stream from your own SDK today, collect the full answer and then call `release()` on it, because a token like `[PERSON_001]` can be split across chunks.

---

← [7. Policies](07-policies-and-minimization.md) · Next: [9. Command-line tool →](09-cli.md)
