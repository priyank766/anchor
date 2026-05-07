import type { Store } from "../store/db.js";
import { redact } from "../capture/redact.js";
import { hostname } from "node:os";
import { z } from "zod";
import { resolveDefaultScope } from "../scope.js";

export const SupersedeInput = z.object({
  oldId: z.string().min(1),
  content: z.string().min(1).max(8000),
  rationale: z.string().max(4000).optional(),
  scope: z.string().optional(),
  agent: z.string().default("unknown"),
  sessionId: z.string().optional(),
});

export function handleSupersede(store: Store, raw: unknown) {
  const input = SupersedeInput.parse(raw);

  const { text: safeContent, redacted } = redact(input.content);
  const safeRationale = input.rationale ? redact(input.rationale).text : undefined;

  const scope = store.resolveScope(resolveDefaultScope(input.scope));
  const sourceId = store.recordSource({
    agent: input.agent,
    sessionId: input.sessionId,
    deviceId: hostname(),
  });

  // Probe the old row's type by attempting the supersession update.
  // The store call is itself the type discriminator — it returns which table
  // matched (fact or decision) so we know what to insert next.
  // We optimistically insert as the same type. If the old row didn't exist,
  // the supersession update returns null and we surface an error.
  let newId: string;
  // First, peek the type without writing yet — we need to know what to insert.
  const peekFact = (store as unknown as { db: { prepare: (sql: string) => { get: (id: string) => unknown } } }).db
    .prepare("SELECT id FROM facts WHERE id = ?")
    .get(input.oldId);
  const peekDecision = peekFact
    ? null
    : (store as unknown as { db: { prepare: (sql: string) => { get: (id: string) => unknown } } }).db
        .prepare("SELECT id FROM decisions WHERE id = ?")
        .get(input.oldId);

  if (peekFact) {
    newId = store.insertFact({
      scopeId: scope.id,
      sourceId,
      content: safeContent,
    });
  } else if (peekDecision) {
    newId = store.insertDecision({
      scopeId: scope.id,
      sourceId,
      content: safeContent,
      rationale: safeRationale,
    });
  } else {
    throw new Error(`no fact or decision found with id ${input.oldId}`);
  }

  const supersededType = store.markSuperseded(input.oldId, newId);
  if (!supersededType) {
    throw new Error(`failed to mark ${input.oldId} as superseded`);
  }

  return {
    oldId: input.oldId,
    newId,
    type: supersededType,
    scope: scope.name,
    redacted: redacted.length ? redacted : undefined,
  };
}
