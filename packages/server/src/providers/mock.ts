// Test-only embed provider. Deterministic hash → fixed-dim vector. Useful for
// integration tests where we want the embedding code path to run without
// hitting an external service.

import type { EmbedProvider } from "./types.js";

export class MockEmbedProvider implements EmbedProvider {
  readonly id = "mock:hash:32";
  readonly dimensions = 32;

  async embed(text: string): Promise<number[]> {
    const v = new Array(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      v[i % this.dimensions] += text.charCodeAt(i) / 255;
    }
    // Normalize so cosine works as expected.
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / mag);
  }
}
