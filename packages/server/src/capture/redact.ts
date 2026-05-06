// Secret redaction. Runs at write time. Fail closed: if anything throws, the
// caller treats redaction as failed and refuses the write.
//
// We're conservative: false positives (over-redaction) are fine. False negatives
// (a real key getting into memory) are catastrophic for trust.

const PATTERNS: { name: string; re: RegExp; replace: string }[] = [
  // Anthropic — must come before OpenAI (sk-ant-... would otherwise match the openai pattern)
  { name: "anthropic", re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g, replace: "[REDACTED:anthropic]" },
  // OpenAI-style: sk-... / sk-proj-... (but not sk-ant-, handled above)
  { name: "openai", re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_\-]{20,}\b/g, replace: "[REDACTED:openai]" },
  // GitHub
  { name: "github", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, replace: "[REDACTED:github]" },
  // AWS access key
  { name: "aws-akid", re: /\bAKIA[0-9A-Z]{16}\b/g, replace: "[REDACTED:aws]" },
  // AWS secret (rough — high entropy 40-char base64-ish)
  { name: "aws-secret", re: /\b(?<![A-Za-z0-9/+])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+])\b/g, replace: "[REDACTED:aws-secret?]" },
  // Google API key
  { name: "google", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g, replace: "[REDACTED:google]" },
  // Slack tokens
  { name: "slack", re: /\bxox[abprs]-[A-Za-z0-9\-]{10,}\b/g, replace: "[REDACTED:slack]" },
  // Stripe
  { name: "stripe", re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g, replace: "[REDACTED:stripe]" },
  // JWT (three base64url segments separated by dots; require eyJ... header)
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g, replace: "[REDACTED:jwt]" },
  // Private key blocks
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, replace: "[REDACTED:private-key]" },
  // .env-style assignments containing likely-secret names
  {
    name: "env-secret",
    re: /\b((?:[A-Z][A-Z0-9_]*_)?(?:SECRET|TOKEN|API_KEY|APIKEY|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY))\s*=\s*["']?([^"'\s]{8,})["']?/g,
    replace: "$1=[REDACTED:env]",
  },
];

export interface RedactionResult {
  text: string;
  redacted: string[]; // names of patterns that fired
}

export function redact(input: string): RedactionResult {
  let out = input;
  const fired = new Set<string>();
  for (const p of PATTERNS) {
    if (p.re.test(out)) {
      fired.add(p.name);
      // Reset lastIndex for global regex reuse
      p.re.lastIndex = 0;
      out = out.replace(p.re, p.replace);
    }
  }
  return { text: out, redacted: [...fired] };
}
