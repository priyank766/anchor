// Pluggable provider interfaces.
//
// Anchor's core never requires a provider. BM25 retrieval works with no
// configuration, no API keys, no models. Providers are strictly opt-in
// upgrades: configure one and recall becomes hybrid (BM25 + vector).
//
// We define a narrow interface so adapters stay tiny. There are no helpers,
// no shared base class — every adapter is a single file.

export interface EmbedProvider {
  /** Stable identifier persisted with each vector. Used to detect provider
   * mismatches on read (e.g. switched from Ollama nomic-embed to OpenAI). */
  readonly id: string;

  /** Output dimensionality. Must be stable for a given id. */
  readonly dimensions: number;

  /** Embed a single string. Implementations should batch internally if their
   * backend supports it; the simple sequential default is fine for v1. */
  embed(text: string): Promise<number[]>;
}

/** Resolve a provider from environment configuration. Returns null when
 * embeddings are not configured — the entire vector path stays cold.
 *
 * Supported values for ANCHOR_EMBED_PROVIDER (case-insensitive):
 *   ollama   — local; default model nomic-embed-text. No API key.
 *   openai   — hosted; default model text-embedding-3-small. ANCHOR_OPENAI_API_KEY.
 *   gemini   — hosted; default model text-embedding-004. ANCHOR_GEMINI_API_KEY.
 *   voyage   — hosted; default model voyage-3. ANCHOR_VOYAGE_API_KEY.
 *              (Anthropic's recommended embedding partner — they have no
 *              first-party embeddings API.)
 */
export async function loadEmbedProvider(): Promise<EmbedProvider | null> {
  const kind = (process.env.ANCHOR_EMBED_PROVIDER ?? "").toLowerCase().trim();
  if (!kind) return null;
  switch (kind) {
    case "ollama": {
      const { OllamaEmbedProvider } = await import("./ollama.js");
      return new OllamaEmbedProvider();
    }
    case "openai": {
      const { OpenAIEmbedProvider } = await import("./openai.js");
      return new OpenAIEmbedProvider();
    }
    case "gemini": {
      const { GeminiEmbedProvider } = await import("./gemini.js");
      return new GeminiEmbedProvider();
    }
    case "voyage":
    case "anthropic": {
      // We accept "anthropic" as an alias since users will reach for it; the
      // adapter is Voyage. Document this loudly in the error path below.
      const { VoyageEmbedProvider } = await import("./voyage.js");
      return new VoyageEmbedProvider();
    }
    default:
      throw new Error(
        `unknown ANCHOR_EMBED_PROVIDER: "${kind}" (supported: ollama, openai, gemini, voyage)`
      );
  }
}
