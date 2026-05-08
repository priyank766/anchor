// Google Gemini embedding adapter.
// Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent
// Models (auto-detected dimensions):
//   text-embedding-004      768
//   gemini-embedding-001    3072
//
// Auth via ANCHOR_GEMINI_API_KEY (preferred) or GEMINI_API_KEY.

import type { EmbedProvider } from "./types.js";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "text-embedding-004";

const KNOWN_MODELS: Record<string, number> = {
  "text-embedding-004": 768,
  "gemini-embedding-001": 3072,
};

export class GeminiEmbedProvider implements EmbedProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor() {
    const key = process.env.ANCHOR_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "Gemini provider requires ANCHOR_GEMINI_API_KEY (or GEMINI_API_KEY)."
      );
    }
    this.apiKey = key;
    this.baseUrl = process.env.ANCHOR_GEMINI_URL ?? DEFAULT_BASE;
    this.model = process.env.ANCHOR_EMBED_MODEL ?? DEFAULT_MODEL;

    const dimsEnv = process.env.ANCHOR_EMBED_DIMENSIONS;
    if (dimsEnv) {
      const parsed = parseInt(dimsEnv, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`invalid ANCHOR_EMBED_DIMENSIONS: ${dimsEnv}`);
      }
      this.dimensions = parsed;
    } else if (KNOWN_MODELS[this.model]) {
      this.dimensions = KNOWN_MODELS[this.model]!;
    } else {
      throw new Error(
        `Unknown Gemini embedding model "${this.model}". Set ANCHOR_EMBED_DIMENSIONS or pick one of: ${Object.keys(KNOWN_MODELS).join(", ")}.`
      );
    }
    this.id = `gemini:${this.model}:${this.dimensions}`;
  }

  async embed(text: string): Promise<number[]> {
    // Note: API key as query param is the documented Gemini auth method.
    const url = `${this.baseUrl}/models/${this.model}:embedContent?key=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status} ${res.statusText}: ${body}`);
    }
    const json = (await res.json()) as {
      embedding?: { values?: number[] };
    };
    const vec = json.embedding?.values;
    if (!Array.isArray(vec)) {
      throw new Error("Gemini response missing embedding.values");
    }
    if (vec.length !== this.dimensions) {
      throw new Error(
        `Gemini returned ${vec.length} dims, expected ${this.dimensions} for ${this.model}`
      );
    }
    return vec;
  }
}
