import { Aran } from "aiaran";

const aran = new Aran({ policy: "financial" });

const ticket = {
  customer: { name: "Kiran Rao", email: "kiran.rao@example.com", phone: 9876543210 },
  account_number: "50100123456789",
  message: "My UPI kiran.rao@okaxis payment (UTR 412345678901) failed twice.",
  priority: 2,
};

const result = await aran.protect({ type: "text", data: ticket });
console.log(JSON.stringify(result.safeData, null, 2));
await aran.dispose();
