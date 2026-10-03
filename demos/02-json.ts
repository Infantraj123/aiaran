/**
 * Demo 2 — Structured JSON (API payloads, database rows, tickets)
 * Run: node demos/02-json.ts
 */
import { Aran } from "aiaran";
import { printEntities, step, title } from "./_shared.ts";

title("DEMO 2 — Protecting JSON objects");

const aran = new Aran({ policy: "financial" });

const ticket = {
  ticketId: 7781,
  customer: {
    name: "Kiran Rao", // field name "name" → treated as PERSON
    email: "kiran.rao@example.com",
    phone: 9876543210, // numbers in sensitive fields are protected too
  },
  account_number: "50100123456789",
  message:
    "My UPI kiran.rao@okaxis payment (UTR 412345678901) failed twice. Card 4111 1111 1111 1111 was not charged.",
  priority: "high",
};

step("1. Original object");
console.log(JSON.stringify(ticket, null, 2));

step("2. Protected object (same shape, sensitive values replaced)");
const result = await aran.protect({ type: "text", data: ticket });
console.log("status:", result.status);
console.log(JSON.stringify(result.safeData, null, 2));
printEntities(result.detectedEntities, result.actions);

step("3. Why 'blocked'? The financial policy blocks card numbers outright");
console.log("blocked types:", result.minimization.blocked);

step("4. Same ticket without the card number");
const { message, ...rest } = ticket;
const withoutCard = { ...rest, message: message.replace(/ Card .*$/, "") };
const ok = await aran.protect({ type: "text", data: withoutCard });
console.log("status:", ok.status);
console.log(JSON.stringify(ok.safeData, null, 2));

await aran.dispose();
