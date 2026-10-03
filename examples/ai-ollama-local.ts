import { Aran, OllamaProvider } from "aiaran";

// Everything stays on this machine: local detection, local OCR, local model.
const aran = new Aran({ policy: "developer" });
const provider = new OllamaProvider({ model: process.env.OLLAMA_MODEL ?? "llama3.2" });

const log = `2026-10-03T10:00:00Z ERROR db connect failed postgres://admin:S3cr3tPassw0rd@10.20.30.40:5432/app
user=ravi.kumar@example.com token=${"ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`; // synthetic token

const { text, protection } = await aran.generate(
  provider,
  { type: "text", data: log },
  { system: "Explain the error briefly." },
);
console.log(protection.safeData);
console.log(text);
await aran.dispose();
