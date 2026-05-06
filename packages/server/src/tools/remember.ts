import type { Store } from "../store/db.js";
import { redact } from "../capture/redact.js";
import { RememberInput } from "./schemas.js";
import { hostname } from "node:os";

export function handleRemember(store: Store, raw: unknown) {
  const input = RememberInput.parse(raw);

  const sourceContent = input.content ?? input.ref ?? "";
  const { text: safeContent, redacted } = redact(sourceContent);
  const safeRationale = input.rationale ? redact(input.rationale).text : undefined;
  const safeNote = input.note ? redact(input.note).text : undefined;
  const safeRef = input.ref ? redact(input.ref).text : undefined;

  const scope = store.resolveScope(input.scope);
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

  return {
    id,
    scope: scope.name,
    type: input.type,
    redacted: redacted.length ? redacted : undefined,
  };
}
