import { Aran, AnthropicProvider } from "aiaran";

// Requires: npm install @anthropic-ai/sdk  (credentials via ANTHROPIC_API_KEY or `ant auth login`)
const aran = new Aran({ policy: "healthcare" });
const provider = new AnthropicProvider({ model: "claude-opus-5-5" });

const result = await aran.generate(
  provider,
  {
    type: "text",
    data: "Patient John Smith, patient ID P123456, age 52, BP 150/95, LDL 190. Summarize for the care team.",
    purpose: "summarize medical condition",
  },
  { system: "You are a clinical documentation assistant. Be concise." },
);

console.log(result.text);
await aran.dispose();
