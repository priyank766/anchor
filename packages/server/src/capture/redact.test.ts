import { describe, it, expect } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("strips OpenAI keys", () => {
    const r = redact("here is sk-proj-AAAAbbbbCCCCddddEEEEffffGGGGhhhh");
    expect(r.text).not.toContain("sk-proj-AAAA");
    expect(r.redacted).toContain("openai");
  });

  it("strips Anthropic keys", () => {
    const r = redact("token sk-ant-api03-aaabbbcccdddeeefff111222333444");
    expect(r.text).not.toContain("sk-ant-api03");
    expect(r.redacted).toContain("anthropic");
  });

  it("strips GitHub tokens", () => {
    const r = redact("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(r.text).toContain("[REDACTED:github]");
  });

  it("strips JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturepartXYZ";
    const r = redact(`auth: ${jwt}`);
    expect(r.text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(r.redacted).toContain("jwt");
  });

  it("strips AWS access keys", () => {
    const r = redact("AKIAIOSFODNN7EXAMPLE");
    expect(r.redacted).toContain("aws-akid");
  });

  it("redacts .env-style secret assignments", () => {
    const r = redact('OPENAI_API_KEY="abcdefghijklmno"');
    expect(r.text).toContain("[REDACTED:env]");
    expect(r.redacted).toContain("env-secret");
  });

  it("leaves benign content alone", () => {
    const r = redact("user prefers pnpm over npm");
    expect(r.text).toBe("user prefers pnpm over npm");
    expect(r.redacted).toEqual([]);
  });
});
