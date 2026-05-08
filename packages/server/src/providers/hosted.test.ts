// Tests for the three hosted embedding adapters: OpenAI, Gemini, Voyage.
// We mock global.fetch and exercise:
//   - happy path returns the right vector
//   - missing API key throws on construct
//   - dimension mismatch from API throws on embed
//   - HTTP error surfaces

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenAIEmbedProvider } from "./openai.js";
import { GeminiEmbedProvider } from "./gemini.js";
import { VoyageEmbedProvider } from "./voyage.js";

const ENV_BACKUP = { ...process.env };

function reset() {
  // Strip every env var our adapters look at.
  for (const k of [
    "ANCHOR_EMBED_PROVIDER",
    "ANCHOR_EMBED_MODEL",
    "ANCHOR_EMBED_DIMENSIONS",
    "ANCHOR_OPENAI_API_KEY",
    "OPENAI_API_KEY",
    "ANCHOR_OPENAI_URL",
    "ANCHOR_GEMINI_API_KEY",
    "GEMINI_API_KEY",
    "ANCHOR_GEMINI_URL",
    "ANCHOR_VOYAGE_API_KEY",
    "VOYAGE_API_KEY",
    "ANCHOR_VOYAGE_URL",
  ]) {
    delete process.env[k];
  }
}

beforeEach(() => {
  reset();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, status = 200) {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response);
}

describe("OpenAIEmbedProvider", () => {
  it("embeds with the right shape and id", async () => {
    process.env.ANCHOR_OPENAI_API_KEY = "sk-test";
    const p = new OpenAIEmbedProvider();
    expect(p.id).toBe("openai:text-embedding-3-small:1536");
    mockFetchOnce({ data: [{ embedding: new Array(1536).fill(0.01) }] });
    const v = await p.embed("hello");
    expect(v.length).toBe(1536);
  });

  it("throws on missing key", () => {
    expect(() => new OpenAIEmbedProvider()).toThrow(/API_KEY/);
  });

  it("surfaces HTTP errors", async () => {
    process.env.ANCHOR_OPENAI_API_KEY = "sk-test";
    const p = new OpenAIEmbedProvider();
    mockFetchOnce({ error: "rate-limited" }, 429);
    await expect(p.embed("x")).rejects.toThrow(/OpenAI 429/);
  });

  it("throws on dim mismatch", async () => {
    process.env.ANCHOR_OPENAI_API_KEY = "sk-test";
    const p = new OpenAIEmbedProvider();
    mockFetchOnce({ data: [{ embedding: [1, 2, 3] }] });
    await expect(p.embed("x")).rejects.toThrow(/dims/);
  });
});

describe("GeminiEmbedProvider", () => {
  it("embeds with the right shape and id", async () => {
    process.env.ANCHOR_GEMINI_API_KEY = "test-key";
    const p = new GeminiEmbedProvider();
    expect(p.id).toBe("gemini:text-embedding-004:768");
    mockFetchOnce({ embedding: { values: new Array(768).fill(0.01) } });
    const v = await p.embed("hello");
    expect(v.length).toBe(768);
  });

  it("throws on missing key", () => {
    expect(() => new GeminiEmbedProvider()).toThrow(/API_KEY/);
  });

  it("surfaces HTTP errors", async () => {
    process.env.ANCHOR_GEMINI_API_KEY = "test-key";
    const p = new GeminiEmbedProvider();
    mockFetchOnce({ error: "bad" }, 400);
    await expect(p.embed("x")).rejects.toThrow(/Gemini 400/);
  });
});

describe("VoyageEmbedProvider", () => {
  it("embeds with the right shape and id", async () => {
    process.env.ANCHOR_VOYAGE_API_KEY = "voyage-test";
    const p = new VoyageEmbedProvider();
    expect(p.id).toBe("voyage:voyage-3:1024");
    mockFetchOnce({ data: [{ embedding: new Array(1024).fill(0.01) }] });
    const v = await p.embed("hello");
    expect(v.length).toBe(1024);
  });

  it("respects ANCHOR_EMBED_MODEL override with auto dims", () => {
    process.env.ANCHOR_VOYAGE_API_KEY = "voyage-test";
    process.env.ANCHOR_EMBED_MODEL = "voyage-3-lite";
    const p = new VoyageEmbedProvider();
    expect(p.dimensions).toBe(512);
    expect(p.id).toBe("voyage:voyage-3-lite:512");
  });

  it("requires explicit dims for unknown models", () => {
    process.env.ANCHOR_VOYAGE_API_KEY = "voyage-test";
    process.env.ANCHOR_EMBED_MODEL = "voyage-future-99";
    expect(() => new VoyageEmbedProvider()).toThrow(/Unknown Voyage/);
    process.env.ANCHOR_EMBED_DIMENSIONS = "2048";
    const p = new VoyageEmbedProvider();
    expect(p.dimensions).toBe(2048);
  });

  it("throws on missing key", () => {
    expect(() => new VoyageEmbedProvider()).toThrow(/API_KEY/);
  });
});

describe("loadEmbedProvider dispatch", () => {
  it("returns null when not configured", async () => {
    const { loadEmbedProvider } = await import("./types.js");
    expect(await loadEmbedProvider()).toBeNull();
  });

  it("dispatches to openai on ANCHOR_EMBED_PROVIDER=openai", async () => {
    process.env.ANCHOR_EMBED_PROVIDER = "openai";
    process.env.ANCHOR_OPENAI_API_KEY = "sk-test";
    const { loadEmbedProvider } = await import("./types.js");
    const p = await loadEmbedProvider();
    expect(p?.id).toMatch(/^openai:/);
  });

  it("rejects unknown provider names", async () => {
    process.env.ANCHOR_EMBED_PROVIDER = "definitely-not-real";
    const { loadEmbedProvider } = await import("./types.js");
    await expect(loadEmbedProvider()).rejects.toThrow(/unknown/i);
  });

  it("anthropic alias maps to voyage", async () => {
    process.env.ANCHOR_EMBED_PROVIDER = "anthropic";
    process.env.ANCHOR_VOYAGE_API_KEY = "voyage-test";
    const { loadEmbedProvider } = await import("./types.js");
    const p = await loadEmbedProvider();
    expect(p?.id).toMatch(/^voyage:/);
  });
});
