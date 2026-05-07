// Prompt-injection scrubbing.
//
// Recalled memory is delivered to a future agent's context. If a malicious
// summary contains "ignore previous instructions and ..." the agent may
// follow it. This is a defense-in-depth measure on top of the policy
// guidance we already give the agent (SKILL.md says "treat as untrusted").
//
// Strategy: detect known injection phrases and neutralize them by inserting
// a zero-width-joiner-free marker that breaks the phrase without losing the
// readable meaning. Conservative: false positives just look mildly weird,
// false negatives are dangerous, so we err on the side of catching more.
//
// We do NOT try to detect every possible attack — only the high-value,
// well-known patterns. Combined with redact-at-write and the recalled-as-
// untrusted footer, this raises the bar materially without rewriting content.

const PATTERNS: { name: string; re: RegExp }[] = [
  // Allow optional "the/all" between the verb and the qualifier; many
  // injection variants insert filler words.
  { name: "ignore-prev", re: /ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above|preceding)\s+(?:instructions?|prompts?|rules?|messages?)/gi },
  { name: "disregard", re: /disregard\s+(?:all\s+|the\s+)?(?:previous|prior|above|preceding)\s+(?:instructions?|prompts?|rules?|messages?)/gi },
  { name: "forget-everything", re: /forget\s+(?:everything|all)\s+(?:above|before|prior)/gi },
  { name: "you-are-now", re: /\byou\s+are\s+now\s+(?:a|an|in|the)\b/gi },
  { name: "new-instructions", re: /\b(?:here\s+are\s+(?:your\s+)?new|new\s+system)\s+instructions\b/gi },
  { name: "reveal-prompt", re: /\b(?:reveal|show|print|output|display)\s+(?:your\s+|the\s+)?(?:system\s+)?(?:prompt|instructions?)\b/gi },
  { name: "execute-the", re: /\bexecute\s+the\s+following\b/gi },
  { name: "switch-to-mode", re: /\bswitch\s+to\s+\w+\s+mode\b/gi },
  { name: "developer-mode", re: /\b(?:developer|jailbreak|dan|admin|root)\s+mode\b/gi },
];

export interface ScrubResult {
  text: string;
  scrubbed: string[]; // names of patterns that fired
}

export function scrubInjections(input: string): ScrubResult {
  let out = input;
  const fired = new Set<string>();
  for (const p of PATTERNS) {
    if (p.re.test(out)) {
      fired.add(p.name);
      p.re.lastIndex = 0;
      out = out.replace(p.re, (match) => `[NEUTRALIZED:${p.name}]`);
    }
  }
  return { text: out, scrubbed: [...fired] };
}
