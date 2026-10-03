import { Aran, OpenAIProvider } from "aiaran";

const aran = new Aran({ policy: "default" });
const provider = new OpenAIProvider({ model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" }); // reads OPENAI_API_KEY

const { text, protection, release } = await aran.generate(
  provider,
  {
    type: "text",
    data: "Draft a polite reply to Emily Carter (emily.carter@example.com) about her delayed order #A-77812.",
  },
  { system: "You write short, friendly customer-support emails." },
);

console.log("Sent to the model:", protection.safeData);
console.log("Restored reply:", text);
console.log(
  "Output warnings:",
  release.warnings.map((w) => w.code),
);
await aran.dispose();
