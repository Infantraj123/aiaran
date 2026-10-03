import { describe, expect, it } from "vitest";
import { createSecretDetector } from "../../src/detection/secret-detector.js";
import { found } from "../helpers/detect.js";
import { S } from "../helpers/synthetic.js";

const secrets = createSecretDetector();

describe("secret detector", () => {
  it.each([
    ["API_KEY", S.openaiKey],
    ["API_KEY", S.anthropicKey],
    ["API_KEY", S.googleKey],
    ["API_KEY", S.stripeKey],
    ["AWS_ACCESS_KEY", S.awsKey],
    ["GITHUB_TOKEN", S.githubToken],
    ["JWT", S.jwt],
  ])("detects %s", async (type, value) => {
    expect(await found(secrets, `token: ${value} end`)).toContain(`${type}=${value}`);
  });

  it("detects PEM private keys", async () => {
    const results = await found(secrets, `key:\n${S.privateKey}\n`);
    expect(results).toContain(`PRIVATE_KEY=${S.privateKey}`);
  });

  it("detects database URLs with credentials as a whole", async () => {
    expect(await found(secrets, `DATABASE_URL=${S.dbUrl}`)).toContain(`DATABASE_URL=${S.dbUrl}`);
  });

  it("detects passwords in assignments and URLs", async () => {
    expect(await found(secrets, 'password: "Tr0ub4dor&3"')).toContain("PASSWORD=Tr0ub4dor&3");
    expect(await found(secrets, "PWD=hunter2xyz")).toContain("PASSWORD=hunter2xyz");
    expect(await found(secrets, "https://bob:pa55word@example.com/x")).toContain(
      "PASSWORD=pa55word",
    );
    expect(await found(secrets, "पासवर्ड: Gupt@123")).toContain("PASSWORD=Gupt@123");
  });

  it("ignores placeholder passwords and secrets", async () => {
    expect(await found(secrets, "password: ********")).toEqual([]);
    expect(await found(secrets, "password=${DB_PASSWORD}")).toEqual([]);
    expect(await found(secrets, "api_key = 'your_api_key_here'")).toEqual([]);
    expect(await found(secrets, "secret = changeme")).toEqual([]);
  });

  it("detects bearer tokens and AWS secret keys", async () => {
    expect(await found(secrets, "Authorization: Bearer abcDEF123456ghiJKL789")).toContain(
      "ACCESS_TOKEN=abcDEF123456ghiJKL789",
    );
    expect(await found(secrets, `aws_secret_access_key = ${S.awsSecret}`)).toContain(
      `SECRET=${S.awsSecret}`,
    );
  });

  it("detects generic high-entropy secret assignments", async () => {
    expect(await found(secrets, 'client_secret: "9fK2xQ7pL4mN8vB1zR6t"')).toContain(
      "SECRET=9fK2xQ7pL4mN8vB1zR6t",
    );
    expect(await found(secrets, "STRIPE_WEBHOOK_SECRET=whsec_9fK2xQ7pL4mN8vB1")).toContain(
      "SECRET=whsec_9fK2xQ7pL4mN8vB1",
    );
  });
});
