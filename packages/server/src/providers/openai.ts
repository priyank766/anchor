// OpenAI embedding adapter.
// Endpoint: POST https://api.openai.com/v1/embeddings
// Models (auto-detected dimensions):
//   text-embedding-3-small   1536
//   text-embedding-3-large   3072
//   text-embedding-ada-002   1536  (legacy)
//
// Auth via ANCHOR_OPENAI_API_KEY (preferred) or OPENAI_API_KEY.

import type { EmbedProvider } from "./types.js";

const DEFAULT_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";

const KNOWN_MODELS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export class OpenAIEmbedProvider implements EmbedProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly url: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor() {
    const key = process.env.ANCHOR_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OpenAI provider requires ANCHOR_OPENAI_API_KEY (or OPENAI_API_KEY)."
      );
    }
    this.apiKey = key;
    this.url = process.env.ANCHOR_OPENAI_URL ?? DEFAULT_URL;
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
        `Unknown OpenAI embedding model "${this.model}". Set ANCHOR_EMBED_DIMENSIONS or pick one of: ${Object.keys(KNOWN_MODELS).join(", ")}.`
      );
    }
    this.id = `openai:${this.model}:${this.dimensions}`;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status} ${res.statusText}: ${body}`);
    }
    const json = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec)) {
      throw new Error("OpenAI response missing data[0].embedding");
    }
    if (vec.length !== this.dimensions) {
      throw new Error(
        `OpenAI returned ${vec.length} dims, expected ${this.dimensions} for ${this.model}`
      );
    }
    return vec;
  }
}
