// Voyage AI embedding adapter.
//
// Why Voyage and not "Anthropic"? Anthropic has no first-party embeddings
// API. Their official guidance is to use Voyage (https://www.voyageai.com),
// who they partnered with. So `ANCHOR_EMBED_PROVIDER=voyage` is the right
// path for users in the Anthropic ecosystem who want hosted embeddings.
//
// Endpoint: POST https://api.voyageai.com/v1/embeddings
// Models (auto-detected dimensions):
//   voyage-3            1024
//   voyage-3-lite        512
//   voyage-large-2      1536
//   voyage-code-2       1536
//
// Auth via ANCHOR_VOYAGE_API_KEY (preferred) or VOYAGE_API_KEY.

import type { EmbedProvider } from "./types.js";

const DEFAULT_URL = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-3";

const KNOWN_MODELS: Record<string, number> = {
  "voyage-3": 1024,
  "voyage-3-lite": 512,
  "voyage-large-2": 1536,
  "voyage-code-2": 1536,
};

export class VoyageEmbedProvider implements EmbedProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly url: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor() {
    const key = process.env.ANCHOR_VOYAGE_API_KEY ?? process.env.VOYAGE_API_KEY;
    if (!key) {
      throw new Error(
        "Voyage provider requires ANCHOR_VOYAGE_API_KEY (or VOYAGE_API_KEY)."
      );
    }
    this.apiKey = key;
    this.url = process.env.ANCHOR_VOYAGE_URL ?? DEFAULT_URL;
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
        `Unknown Voyage embedding model "${this.model}". Set ANCHOR_EMBED_DIMENSIONS or pick one of: ${Object.keys(KNOWN_MODELS).join(", ")}.`
      );
    }
    this.id = `voyage:${this.model}:${this.dimensions}`;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [text],
        // input_type tells Voyage to optimize the embedding for retrieval.
        // We use "document" on write paths; see types.ts for context.
        input_type: "document",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Voyage ${res.status} ${res.statusText}: ${body}`);
    }
    const json = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec)) {
      throw new Error("Voyage response missing data[0].embedding");
    }
    if (vec.length !== this.dimensions) {
      throw new Error(
        `Voyage returned ${vec.length} dims, expected ${this.dimensions} for ${this.model}`
      );
    }
    return vec;
  }
}
