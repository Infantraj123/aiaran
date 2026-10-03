/**
 * Demo 7 — Full AI round trip with generate()
 *
 * Runs offline with a built-in mock model by default. To use a real model:
 *   AI_PROVIDER=openai    OPENAI_API_KEY=...  AI_MODEL=<model>      node demos/07-ai-providers.ts
 *   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... AI_MODEL=claude-opus-5-5 node demos/07-ai-providers.ts
 *   AI_PROVIDER=gemini    GEMINI_API_KEY=...  AI_MODEL=<model>      node demos/07-ai-providers.ts
 *   AI_PROVIDER=ollama    AI_MODEL=llama3.2                          node demos/07-ai-providers.ts
 *   AI_PROVIDER=compatible AI_BASE_URL=http://localhost:8000/v1 AI_MODEL=<model> node demos/07-ai-providers.ts
 */
import {
  Aran,
  AnthropicProvider,
  GeminiProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
  OpenAIProvider,
  createProvider,
  type AIProvider,
  type AIRequest,
} from "aiaran";
import { step, title } from "./_shared.ts";

title("DEMO 7 — Protect → AI → release, with any provider");

const sentToModel: AIRequest[] = [];

function chooseProvider(): AIProvider {
  const model = process.env.AI_MODEL;
  switch (process.env.AI_PROVIDER) {
    case "openai":
      return new OpenAIProvider({ ...(model ? { model } : {}) });
    case "anthropic":
      return new AnthropicProvider({ model: model ?? "claude-opus-5-5" });
    case "gemini":
      return new GeminiProvider({ ...(model ? { model } : {}) });
    case "ollama":
      return new OllamaProvider({ model: model ?? "llama3.2" });
    case "compatible":
      return new OpenAICompatibleProvider({
        baseURL: process.env.AI_BASE_URL ?? "http://localhost:8000/v1",
        ...(model ? { model } : {}),
      });
    default:
      // Mock model: records what it receives and answers using the placeholders.
      return createProvider("mock-model", async (request) => {
        sentToModel.push(request);
        const content = request.messages[0]?.content;
        const text = typeof content === "string" ? content : "";
        const people = text.match(/\[PERSON_\d{3}\]/g) ?? [];
        return `Summary for ${people[0] ?? "the patient"}: hypertension (150/95), age 52, on atorvastatin. Follow up with ${people[1] ?? "the doctor"} in 2 weeks.`;
      });
  }
}

const aran = new Aran({ policy: "healthcare" });
const provider = chooseProvider();
console.log("provider:", provider.name);

const note = `Patient John Smith, patient ID P123456, age 52.
Phone +91 98765 43210, email john.smith@example.com.
BP 150/95, LDL 190 mg/dL, started atorvastatin. Seen by Dr. Priya Raman.`;

step("1. One call does everything: protect → provider → scan output → restore");
const { text, protection, release, response } = await aran.generate(
  provider,
  { type: "text", data: note, purpose: "patient communication: summarise the visit" },
  { system: "You write short clinical visit summaries.", maxTokens: 300 },
);

step("2. What the model actually received");
if (sentToModel[0]) console.log(JSON.stringify(sentToModel[0], null, 2));
else console.log(protection.safeData);

step("3. Final answer for your app (tokens restored)");
console.log(text);
console.log(
  "\nrestored tokens:",
  release.restoredTokens,
  "| output warnings:",
  release.warnings.map((w) => w.code),
);
console.log("model:", response.model ?? "-", "| usage:", response.usage ?? "-");

step("4. Doing it manually (if you call the model yourself)");
const p = await aran.protect({
  type: "text",
  data: "Remind Ravi Kumar about tomorrow's 10am appointment.",
});
if (p.status !== "safe" || p.safeData === null) throw new Error("Not safe to send");
const fakeModelReply = `Hi [PERSON_001], this is a reminder about your appointment tomorrow at 10am.`;
console.log((await aran.release(fakeModelReply, p.sessionId)).data);

step("5. Blocked requests never reach the provider");
try {
  await aran.generate(provider, {
    type: "text",
    data: "My card is 4111 1111 1111 1111, please store it.",
  });
} catch (error) {
  console.log(`${(error as Error).name}: ${(error as Error).message}`);
}

await aran.dispose();
