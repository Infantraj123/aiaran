import { RegexDetector, WB, WE, type PatternRule } from "./regex-detector.js";
import { jwtLooksValid, looksLikeSecret } from "./validators.js";

/**
 * Detection of credentials and secrets: provider API keys, access tokens,
 * JWTs, private keys, database URLs, cloud credentials and generic
 * `secret = value` assignments (entropy-checked to avoid placeholders).
 */
const ASSIGN = String.raw`["']?\s*(?:[:=]|=>|:=)\s*["'\x60]?`;

export const SECRET_RULES: readonly PatternRule[] = [
  {
    type: "PRIVATE_KEY",
    id: "pem-private-key",
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]{16,}?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/u,
    confidence: 0.99,
  },
  {
    type: "PRIVATE_KEY",
    id: "pem-private-key-truncated",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[A-Za-z0-9+/=\s]{16,}/u,
    confidence: 0.95,
  },
  {
    type: "JWT",
    id: "jwt",
    pattern: new RegExp(
      String.raw`${WB}eyJ[A-Za-z0-9_\-]{5,}\.eyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{10,}${WE}`,
      "u",
    ),
    confidence: 0.95,
    validate: jwtLooksValid,
    invalidConfidence: 0.8,
    context: { keywords: ["jwt", "token", "bearer", "authorization"], boost: 0.03 },
  },
  {
    type: "AWS_ACCESS_KEY",
    id: "aws-access-key-id",
    pattern: new RegExp(
      String.raw`${WB}(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|APKA)[A-Z0-9]{16}${WE}`,
      "u",
    ),
    confidence: 0.95,
  },
  {
    type: "SECRET",
    id: "aws-secret-access-key",
    pattern:
      /(?:aws_?secret_?access_?key|aws_?secret|secret_?access_?key)["']?\s*(?:[:=]|=>)\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/iu,
    group: 1,
    confidence: 0.95,
  },
  {
    type: "GITHUB_TOKEN",
    id: "github-token",
    pattern: new RegExp(
      String.raw`${WB}(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})${WE}`,
      "u",
    ),
    confidence: 0.98,
  },
  {
    type: "API_KEY",
    id: "anthropic-key",
    pattern: new RegExp(String.raw`${WB}sk-ant-[a-z0-9]{2,10}-[A-Za-z0-9_\-]{20,}${WE}`, "u"),
    confidence: 0.98,
  },
  {
    type: "API_KEY",
    id: "openai-key",
    pattern: new RegExp(
      String.raw`${WB}sk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{20,}${WE}`,
      "u",
    ),
    confidence: 0.9,
    validate: (v) => looksLikeSecret(v, 3.2),
  },
  {
    type: "API_KEY",
    id: "google-api-key",
    pattern: new RegExp(String.raw`${WB}AIza[0-9A-Za-z_\-]{35}${WE}`, "u"),
    confidence: 0.95,
  },
  {
    type: "API_KEY",
    id: "stripe-key",
    pattern: new RegExp(String.raw`${WB}(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}${WE}`, "u"),
    confidence: 0.95,
  },
  {
    type: "API_KEY",
    id: "misc-provider-keys",
    pattern: new RegExp(
      String.raw`${WB}(?:SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}|npm_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{34,}|glpat-[A-Za-z0-9_\-]{20,}|AC[0-9a-f]{32}|SK[0-9a-f]{32}|key-[0-9a-zA-Z]{32}|dop_v1_[a-f0-9]{64}|shpat_[a-fA-F0-9]{32}|xai-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,})${WE}`,
      "u",
    ),
    confidence: 0.93,
  },
  {
    type: "ACCESS_TOKEN",
    id: "slack-token",
    pattern: new RegExp(String.raw`${WB}xox[abposr]-[0-9A-Za-z\-]{10,}${WE}`, "u"),
    confidence: 0.95,
  },
  {
    type: "ACCESS_TOKEN",
    id: "bearer",
    pattern: /(?<![\p{L}\p{N}_])bearer\s+([A-Za-z0-9\-._~+/]{16,}=*)/iu,
    group: 1,
    confidence: 0.9,
  },
  {
    type: "ACCESS_TOKEN",
    id: "token-assignment",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])(?:access[_\-]?token|auth[_\-]?token|refresh[_\-]?token|id[_\-]?token|session[_\-]?token|oauth[_\-]?token|x-auth-token)${ASSIGN}([A-Za-z0-9\-._~+/]{12,}=*)`,
      "iu",
    ),
    group: 1,
    confidence: 0.9,
    validate: (v) => looksLikeSecret(v, 2.8),
  },
  {
    type: "DATABASE_URL",
    id: "database-url",
    pattern:
      /(?<![\p{L}\p{N}_])(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|oracle|cockroachdb|clickhouse|neo4j(?:\+s)?|couchdb|jdbc:[a-z0-9]+):\/\/[^\s"'<>`]+/iu,
    confidence: 0.85,
    trimTrailing: /[.,;)\]}]+$/,
    classify: (v) => ({
      type: "DATABASE_URL",
      confidence: /\/\/[^/@\s]+:[^/@\s]+@/.test(v) ? 0.97 : 0.85,
    }),
  },
  {
    type: "PASSWORD",
    id: "url-credentials",
    pattern: /(?<![\p{L}\p{N}_])[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{1,128})@/iu,
    group: 1,
    confidence: 0.9,
  },
  {
    type: "PASSWORD",
    id: "password-assignment",
    pattern:
      /(?<![\p{L}\p{N}])(?:password|passwd|pwd|pass|passphrase|passcode|pin\s?code|db_?pass(?:word)?|पासवर्ड|கடவுச்சொல்)["']?\s*(?:[:=]|=>|is)\s*["'\x60]?([^\s"'\x60,;]{3,128})/iu,
    group: 1,
    confidence: 0.9,
    validate: (v) =>
      !/^(\*+|x+|\.+|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|\[[A-Z_]+_\d+\]|null|none|undefined|required|optional|incorrect|wrong|invalid|reset|changed|expired)$/i.test(
        v,
      ),
  },
  {
    type: "API_KEY",
    id: "api-key-assignment",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])(?:[a-z0-9_\-]*api[_\-]?key|apikey|x-api-key|api[_\-]?token|subscription[_\-]?key)${ASSIGN}([A-Za-z0-9\-._~+/=]{12,})`,
      "iu",
    ),
    group: 1,
    confidence: 0.88,
    validate: (v) => looksLikeSecret(v, 3.0),
  },
  {
    type: "SECRET",
    id: "secret-assignment",
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])(?:[a-z0-9_\-]*secret(?:[_\-]?key)?|signing[_\-]?key|encryption[_\-]?key|private[_\-]?key|master[_\-]?key|webhook[_\-]?secret|salt|credentials?)${ASSIGN}([A-Za-z0-9\-._~+/=]{12,})`,
      "iu",
    ),
    group: 1,
    confidence: 0.85,
    validate: (v) => looksLikeSecret(v, 3.0),
  },
];

export function createSecretDetector(): RegexDetector {
  return new RegexDetector("aran.secrets", "1.0.0", SECRET_RULES, "secret");
}
