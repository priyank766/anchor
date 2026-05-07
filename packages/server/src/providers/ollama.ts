// Ollama embedding adapter. Local-first; talks to a running Ollama instance
// at $ANCHOR_OLLAMA_URL (default http://127.0.0.1:11434).
//
// Ollama exposes POST /api/embeddings with body { model, prompt } and returns
// { embedding: number[] }. Models worth recommending:
//   - nomic-embed-text  (768 dims, fast, good general retrieval)
//   - mxbai-embed-large (1024 dims, stronger, slower)
//   - all-minilm        (384 dims, smallest, weakest)
//
// We default to nomic-embed-text. Override via ANCHOR_EMBED_MODEL.

import type { EmbedProvider } from "./types.js";

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "nomic-embed-text";

// Dimensions per known model. We refuse models not in this map until the
// caller sets ANCHOR_EMBED_DIMENSIONS explicitly, because mismatched dims
// would silently corrupt vector search.
const KNOWN_MODELS: Record<string, number> = {
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "all-minilm": 384,
  "bge-large": 1024,
  "snowflake-arctic-embed": 1024,
};

export class OllamaEmbedProvider implements EmbedProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly url: string;
  private readonly model: string;

  constructor() {
    this.url = process.env.ANCHOR_OLLAMA_URL ?? DEFAULT_URL;
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
        `Unknown Ollama model "${this.model}". Set ANCHOR_EMBED_DIMENSIONS or pick one of: ${Object.keys(KNOWN_MODELS).join(", ")}.`
      );
    }

    this.id = `ollama:${this.model}:${this.dimensions}`;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.url}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(
        `Ollama ${res.status} ${res.statusText}: ${await res.text().catch(() => "")}`
      );
    }
    const json = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(json.embedding)) {
      throw new Error("Ollama response missing 'embedding' array");
    }
    if (json.embedding.length !== this.dimensions) {
      throw new Error(
        `Ollama returned ${json.embedding.length} dims, expected ${this.dimensions} for model ${this.model}`
      );
    }
    return json.embedding;
  }
}
