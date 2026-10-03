/**
 * Demo 10 — Using ARAN inside a web API (plain node:http, works the same in Express/Fastify/Nest)
 * Run:  node demos/10-web-server.ts
 * Then: curl -s localhost:3000/chat -H 'content-type: application/json' \
 *         -d '{"message":"I am Ravi Kumar, email ravi.kumar@example.com. Summarise my plan."}'
 */
import { createServer } from "node:http";
import { Aran, BlockedError, createProvider } from "aiaran";

// One Aran instance for the whole app (OCR workers and policy are reused).
const aran = new Aran({ policy: "enterprise", logLevel: "info" }); // enterprise blocks secrets

// Replace with OpenAIProvider / AnthropicProvider / OllamaProvider in your app.
const model = createProvider("mock", async (req) => {
  const text = typeof req.messages[0]?.content === "string" ? req.messages[0].content : "";
  const who = /\[PERSON_\d{3}\]/.exec(text)?.[0] ?? "there";
  return `Hi ${who}, here is your plan summary. I'll send a copy to [EMAIL_001].`;
});

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/chat") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { message } = JSON.parse(body) as { message: string };
    const result = await aran.generate(model, { type: "text", data: message });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ reply: result.text, risk: result.protection.summary.riskLevel }));
  } catch (error) {
    const status = error instanceof BlockedError ? 422 : 400;
    res.writeHead(status, { "content-type": "application/json" });
    // Error messages from ARAN never contain user data, so they are safe to return.
    res.end(JSON.stringify({ error: (error as Error).message }));
  }
});

server.listen(3000, () => console.log("ARAN demo API on http://localhost:3000/chat"));

// Self-test when started with --self-test (used by the docs).
if (process.argv.includes("--self-test")) {
  const reply = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "I am Ravi Kumar, email ravi.kumar@example.com. Summarise my plan.",
    }),
  });
  console.log(reply.status, await reply.text());
  const blocked = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // Synthetic GitHub-style token, assembled so secret scanners don't flag this file.
      message: `my password = Hunter2025!xyz and key ${"ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`,
    }),
  });
  console.log(blocked.status, await blocked.text());
  server.close();
  await aran.dispose();
}
