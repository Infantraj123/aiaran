import { Aran } from "aiaran";

const aran = new Aran();

const result = await aran.protect({
  type: "text",
  data: "My name is John and my email is john@example.com",
});

console.log(result.status); // "safe"
console.log(result.safeData); // "My name is [PERSON_001] and my email is [EMAIL_001]"
console.log(result.summary); // { total: 2, counts: { PERSON: 1, EMAIL: 1 }, riskLevel: "MEDIUM" }

// Pretend this came back from an AI model:
const aiResponse = "Thanks [PERSON_001], we will write to [EMAIL_001].";
console.log(await aran.restore(aiResponse, result.sessionId));
// "Thanks John, we will write to john@example.com."

await aran.dispose();
