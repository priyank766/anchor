import type { Store, MemoryType } from "../store/db.js";
import { redact } from "../capture/redact.js";
import { scrubInjections } from "../capture/scrub.js";
import { RememberInput } from "./schemas.js";
import { hostname } from "node:os";
import { resolveDefaultScope } from "../scope.js";
import { loadEmbedProvider } from "../providers/types.js";

// Compose redaction (secrets) with injection scrubbing (untrusted-content
// neutralization). Both run before any content reaches disk.
function clean(input: string): { text: string; redacted: string[]; scrubbed: string[] } {
  const r = redact(input);
  const s = scrubInjections(r.text);
  return { text: s.text, redacted: r.redacted, scrubbed: s.scrubbed };
}

export async function handleRemember(store: Store, raw: unknown) {
  const input = RememberInput.parse(raw);

  const sourceContent = input.content ?? input.ref ?? "";
  const cleanedContent = clean(sourceContent);
  const safeContent = cleanedContent.text;
  const redacted = cleanedContent.redacted;
  const scrubbed = cleanedContent.scrubbed;
  const safeRationale = input.rationale ? clean(input.rationale).text : undefined;
  const safeNote = input.note ? clean(input.note).text : undefined;
  const safeRef = input.ref ? redact(input.ref).text : undefined;

  const scope = store.resolveScope(resolveDefaultScope(input.scope));
  const sourceId = store.recordSource({
    agent: input.agent,
    sessionId: input.sessionId,
    deviceId: hostname(),
  });

  let id: string;
  switch (input.type) {
    case "fact":
      id = store.insertFact({ scopeId: scope.id, sourceId, content: safeContent });
      break;
    case "decision":
      id = store.insertDecision({
        scopeId: scope.id,
        sourceId,
        content: safeContent,
        rationale: safeRationale,
      });
      break;
    case "episode":
      id = store.insertEpisode({
        scopeId: scope.id,
        sourceId,
        summary: safeContent,
        files: input.files,
      });
      break;
    case "artifact":
      if (!safeRef) throw new Error("artifact requires `ref`");
      id = store.insertArtifact({
        scopeId: scope.id,
        sourceId,
        ref: safeRef,
        note: safeNote,
      });
      break;
  }

  // Best-effort embedding. Failure here must NOT fail the write — the row
  // is already persisted, BM25 still works, and embeddings are an optional
  // overlay. We surface the error in the return so callers can see it.
  let embedded: { providerId: string } | { error: string } | undefined;
  const provider = await loadEmbedProvider();
  if (provider) {
    try {
      // Embed a representative string for each type. Decisions get the
      // rationale because that's where the semantic meaning lives.
      const text =
        input.type === "decision" && safeRationale
          ? `${safeContent}\n\nRationale: ${safeRationale}`
          : input.type === "artifact" && safeNote
            ? `${safeRef}: ${safeNote}`
            : safeContent;
      const vector = await provider.embed(text);
      store.upsertEmbedding({
        memoryId: id,
        memoryType: input.type as MemoryType,
        scopeId: scope.id,
        providerId: provider.id,
        vector,
      });
      embedded = { providerId: provider.id };
    } catch (e) {
      embedded = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    id,
    scope: scope.name,
    type: input.type,
    redacted: redacted.length ? redacted : undefined,
    scrubbed: scrubbed.length ? scrubbed : undefined,
    embedded,
  };
}
