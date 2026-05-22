import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import type { AnchorConfig } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";
import { effectiveSalience } from "../retrieval/salience.js";

export type MemoryType = "fact" | "decision" | "episode" | "artifact";

export interface Source {
  id: string;
  agent: string;
  sessionId?: string;
  deviceId: string;
}

export interface ScopeRef {
  id: string;
  path?: string;
  name: string;
}

export interface MemoryRow {
  id: string;
  type: MemoryType;
  scopeId: string;
  sourceId: string;
  content: string;        // for facts/decisions: content; episodes: summary; artifacts: ref+note joined
  rationale?: string;
  files?: string[];
  ref?: string;
  note?: string;
  supersededBy?: string;
  salience?: number;
  lastVerifiedAt?: number;
  language?: string;
  createdAt: number;
  updatedAt: number;
}

export class Store {
  private db: Database.Database;

  constructor(cfg: AnchorConfig) {
    this.db = new Database(cfg.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);

    // Backward compatibility: automatically alter existing tables to add the language column if needed
    for (const table of ["facts", "decisions", "episodes", "artifacts"]) {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN language TEXT`);
      } catch (e) {
        // Column already exists or table doesn't exist yet, safe to swallow
      }
    }
  }

  // --- Scopes -------------------------------------------------------------

  resolveScope(pathOrName: string | undefined): ScopeRef {
    const name = pathOrName ?? "global";
    const id = createHash("sha1").update(name).digest("hex").slice(0, 16);
    const existing = this.db
      .prepare("SELECT id, path, name FROM scopes WHERE id = ?")
      .get(id) as ScopeRef | undefined;
    if (existing) return existing;
    const isPath = pathOrName && (pathOrName.includes("/") || pathOrName.includes("\\"));
    this.db
      .prepare("INSERT INTO scopes (id, path, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, isPath ? pathOrName : null, name, Date.now());
    return { id, path: isPath ? pathOrName : undefined, name };
  }

  // --- Sources ------------------------------------------------------------

  // Reuse an existing row for (agent, sessionId, deviceId) — otherwise we'd
  // create a fresh source per remember() call and the provenance footer
  // would lie ("N items from N sessions").
  recordSource(s: Omit<Source, "id">): string {
    const sessionKey = s.sessionId ?? "";
    const existing = this.db
      .prepare(
        `SELECT id FROM sources
         WHERE agent = ? AND COALESCE(session_id, '') = ? AND device_id = ?
         LIMIT 1`
      )
      .get(s.agent, sessionKey, s.deviceId) as { id: string } | undefined;
    if (existing) return existing.id;

    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO sources (id, agent, session_id, device_id, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, s.agent, s.sessionId ?? null, s.deviceId, Date.now());
    return id;
  }

  // --- Writes -------------------------------------------------------------

  insertFact(args: {
    scopeId: string;
    sourceId: string;
    content: string;
    language?: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO facts (id, scope_id, source_id, content, language, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, args.scopeId, args.sourceId, args.content, args.language ?? null, now, now);
    return id;
  }

  insertDecision(args: {
    scopeId: string;
    sourceId: string;
    content: string;
    rationale?: string;
    language?: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO decisions (id, scope_id, source_id, content, rationale, language, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, args.scopeId, args.sourceId, args.content, args.rationale ?? null, args.language ?? null, now, now);
    return id;
  }

  insertEpisode(args: {
    scopeId: string;
    sourceId: string;
    summary: string;
    files?: string[];
    language?: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO episodes (id, scope_id, source_id, summary, files, salience, language, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1.0, ?, ?, ?)`
      )
      .run(
        id,
        args.scopeId,
        args.sourceId,
        args.summary,
        args.files ? JSON.stringify(args.files) : null,
        args.language ?? null,
        now,
        now
      );
    return id;
  }

  insertArtifact(args: {
    scopeId: string;
    sourceId: string;
    ref: string;
    note?: string;
    language?: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO artifacts (id, scope_id, source_id, ref, note, language, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, args.scopeId, args.sourceId, args.ref, args.note ?? null, args.language ?? null, now, now);
    return id;
  }

  // --- Deletes ------------------------------------------------------------

  deleteById(id: string): boolean {
    for (const table of ["facts", "decisions", "episodes", "artifacts"] as const) {
      const r = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      if (r.changes > 0) return true;
    }
    return false;
  }

  // --- Embeddings ---------------------------------------------------------

  upsertEmbedding(args: {
    memoryId: string;
    memoryType: MemoryType;
    scopeId: string;
    providerId: string;
    vector: number[];
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO embeddings
         (memory_id, memory_type, scope_id, provider_id, vector, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        args.memoryId,
        args.memoryType,
        args.scopeId,
        args.providerId,
        JSON.stringify(args.vector),
        Date.now()
      );
  }

  // Reads all embeddings in a scope for the given provider. Caller scores
  // them against the query vector. Vector count is bounded by the user's
  // memory volume in this scope; for the local-first product we expect
  // hundreds to low thousands and don't need an ANN index yet.
  listEmbeddings(
    scopeId: string,
    providerId: string
  ): { memoryId: string; memoryType: MemoryType; vector: number[] }[] {
    const rows = this.db
      .prepare(
        `SELECT memory_id, memory_type, vector FROM embeddings
         WHERE scope_id = ? AND provider_id = ?`
      )
      .all(scopeId, providerId) as {
      memory_id: string;
      memory_type: MemoryType;
      vector: string;
    }[];
    return rows.map((r) => ({
      memoryId: r.memory_id,
      memoryType: r.memory_type,
      vector: JSON.parse(r.vector) as number[],
    }));
  }

  // Returns rows in a scope that lack an embedding under the given provider.
  // Used by `anchor reembed` to backfill vectors when a user opts into
  // embeddings on an existing store, or switches providers.
  rowsMissingEmbedding(
    scopeId: string,
    providerId: string
  ): MemoryRow[] {
    // Collect existing vector keys for this provider in this scope.
    const existing = new Set(
      (
        this.db
          .prepare(
            `SELECT memory_id FROM embeddings WHERE scope_id = ? AND provider_id = ?`
          )
          .all(scopeId, providerId) as { memory_id: string }[]
      ).map((r) => r.memory_id)
    );

    const out: MemoryRow[] = [];
    const all = this.listByScope(scopeId, undefined, 100_000);
    for (const r of all) {
      if (!existing.has(r.id)) out.push(r);
    }
    return out;
  }

  hydrateMemoryById(id: string): MemoryRow | null {
    for (const t of ["fact", "decision", "episode", "artifact"] as MemoryType[]) {
      const row = this.fetchSingle(t, id);
      if (row) return row;
    }
    return null;
  }

  private fetchSingle(type: MemoryType, id: string): MemoryRow | null {
    const sqls: Record<MemoryType, string> = {
      fact: `SELECT id, scope_id, source_id, content, superseded_by, language, created_at, updated_at FROM facts WHERE id = ? AND superseded_by IS NULL`,
      decision: `SELECT id, scope_id, source_id, content, rationale, superseded_by, language, created_at, updated_at FROM decisions WHERE id = ? AND superseded_by IS NULL`,
      episode: `SELECT id, scope_id, source_id, summary, files, salience, language, created_at, updated_at FROM episodes WHERE id = ?`,
      artifact: `SELECT id, scope_id, source_id, ref, note, language, created_at, updated_at FROM artifacts WHERE id = ?`,
    };
    const r = this.db.prepare(sqls[type]).get(id) as Record<string, unknown> | undefined;
    return r ? rowToMemory(type, r) : null;
  }

  // --- Supersession -------------------------------------------------------

  // Marks an existing row as superseded by a new id. Returns the type of the
  // old row (so the caller can insert a new row of the same type) or null if
  // no row was found. Only `facts` and `decisions` track supersession; for
  // episodes/artifacts the schema doesn't carry the column and supersession
  // doesn't make semantic sense — caller should `deleteById` + `insert*`.
  markSuperseded(oldId: string, newId: string): "fact" | "decision" | null {
    const fr = this.db
      .prepare("UPDATE facts SET superseded_by = ?, updated_at = ? WHERE id = ?")
      .run(newId, Date.now(), oldId);
    if (fr.changes > 0) return "fact";
    const dr = this.db
      .prepare("UPDATE decisions SET superseded_by = ?, updated_at = ? WHERE id = ?")
      .run(newId, Date.now(), oldId);
    if (dr.changes > 0) return "decision";
    return null;
  }

  // Returns the row a given id was superseded by, walking the chain.
  // Useful for "what's the current version of X".
  resolveSupersedeChain(id: string): string {
    let current = id;
    for (let i = 0; i < 32; i++) {
      const f = this.db
        .prepare("SELECT superseded_by FROM facts WHERE id = ?")
        .get(current) as { superseded_by: string | null } | undefined;
      if (f?.superseded_by) {
        current = f.superseded_by;
        continue;
      }
      const d = this.db
        .prepare("SELECT superseded_by FROM decisions WHERE id = ?")
        .get(current) as { superseded_by: string | null } | undefined;
      if (d?.superseded_by) {
        current = d.superseded_by;
        continue;
      }
      return current;
    }
    return current;
  }

  // --- Reads --------------------------------------------------------------

  listByScope(scopeId: string, type?: MemoryType, limit = 100, activeLanguages?: string[]): MemoryRow[] {
    const tables: { type: MemoryType; sql: string }[] = [
      {
        type: "fact",
        sql: `SELECT id, scope_id, source_id, content, superseded_by, language, created_at, updated_at FROM facts WHERE scope_id = ? AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT ?`,
      },
      {
        type: "decision",
        sql: `SELECT id, scope_id, source_id, content, rationale, superseded_by, language, created_at, updated_at FROM decisions WHERE scope_id = ? AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT ?`,
      },
      {
        type: "episode",
        sql: `SELECT id, scope_id, source_id, summary, files, salience, language, created_at, updated_at FROM episodes WHERE scope_id = ? ORDER BY updated_at DESC LIMIT ?`,
      },
      {
        type: "artifact",
        sql: `SELECT id, scope_id, source_id, ref, note, language, created_at, updated_at FROM artifacts WHERE scope_id = ? ORDER BY updated_at DESC LIMIT ?`,
      },
    ];

    const rows: MemoryRow[] = [];
    for (const t of tables) {
      if (type && t.type !== type) continue;
      const stmt = this.db.prepare(t.sql);
      const results = stmt.all(scopeId, limit) as Record<string, unknown>[];
      for (const r of results) {
        rows.push(rowToMemory(t.type, r));
      }
    }
    // Sort by effective salience (decayed for episodes, full for everything
    // else). Recency falls out for free since salience is multiplied by a
    // recency-decay term.
    const now = Date.now();
    return rows
      .sort((a, b) => rowScore(b, now, activeLanguages) - rowScore(a, now, activeLanguages))
      .slice(0, limit);
  }

  // Delete episodes whose effective salience is below threshold. Returns
  // count deleted. Facts/decisions never auto-prune — supersession is the
  // explicit mechanism for those.
  pruneEpisodes(scopeId: string | undefined, threshold: number): number {
    const where = scopeId ? "WHERE scope_id = ?" : "";
    const params = scopeId ? [scopeId] : [];
    const candidates = this.db
      .prepare(
        `SELECT id, salience, updated_at FROM episodes ${where}`
      )
      .all(...params) as { id: string; salience: number; updated_at: number }[];

    const now = Date.now();
    const toDelete = candidates.filter(
      (r) => effectiveSalience(r.salience, r.updated_at, now) < threshold
    );
    if (toDelete.length === 0) return 0;
    const stmt = this.db.prepare("DELETE FROM episodes WHERE id = ?");
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(id);
    });
    tx(toDelete.map((r) => r.id));
    return toDelete.length;
  }

  searchFTS(scopeId: string, query: string, limit = 50): MemoryRow[] {
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];
    const out: MemoryRow[] = [];

    const facts = this.db
      .prepare(
        `SELECT f.id, f.scope_id, f.source_id, f.content, f.superseded_by, f.language, f.last_verified_at, f.created_at, f.updated_at,
                bm25(facts_fts) as rank
         FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid
         WHERE facts_fts MATCH ? AND f.scope_id = ? AND f.superseded_by IS NULL
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, scopeId, limit) as Record<string, unknown>[];
    for (const r of facts) out.push(rowToMemory("fact", r));

    const decisions = this.db
      .prepare(
        `SELECT d.id, d.scope_id, d.source_id, d.content, d.rationale, d.superseded_by, d.language, d.last_verified_at, d.created_at, d.updated_at,
                bm25(decisions_fts) as rank
         FROM decisions_fts JOIN decisions d ON d.rowid = decisions_fts.rowid
         WHERE decisions_fts MATCH ? AND d.scope_id = ? AND d.superseded_by IS NULL
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, scopeId, limit) as Record<string, unknown>[];
    for (const r of decisions) out.push(rowToMemory("decision", r));

    const episodes = this.db
      .prepare(
        `SELECT e.id, e.scope_id, e.source_id, e.summary, e.files, e.salience, e.language, e.created_at, e.updated_at,
                bm25(episodes_fts) as rank
         FROM episodes_fts JOIN episodes e ON e.rowid = episodes_fts.rowid
         WHERE episodes_fts MATCH ? AND e.scope_id = ?
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, scopeId, limit) as Record<string, unknown>[];
    for (const r of episodes) out.push(rowToMemory("episode", r));

    const artifacts = this.db
      .prepare(
        `SELECT a.id, a.scope_id, a.source_id, a.ref, a.note, a.language, a.created_at, a.updated_at,
                bm25(artifacts_fts) as rank
         FROM artifacts_fts JOIN artifacts a ON a.rowid = artifacts_fts.rowid
         WHERE artifacts_fts MATCH ? AND a.scope_id = ?
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, scopeId, limit) as Record<string, unknown>[];
    for (const r of artifacts) out.push(rowToMemory("artifact", r));

    return out;
  }

  // --- Salience boost + verification ------------------------------------

  // Bump the base salience of episodes that were recalled. For facts/decisions
  // this is a no-op (they don't carry salience); instead we use touchVerified.
  bumpSalience(ids: string[], delta = 0.05): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE episodes SET salience = MIN(salience + ?, 2.0), updated_at = ? WHERE id = ?`
    );
    const now = Date.now();
    const tx = this.db.transaction((list: string[]) => {
      for (const id of list) stmt.run(delta, now, id);
    });
    tx(ids);
  }

  // Mark facts/decisions as "just verified" by setting last_verified_at = now.
  // Called after recall so the stale-fact warning resets its timer.
  touchVerified(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const factStmt = this.db.prepare(
      `UPDATE facts SET last_verified_at = ? WHERE id = ?`
    );
    const decisionStmt = this.db.prepare(
      `UPDATE decisions SET last_verified_at = ? WHERE id = ?`
    );
    const tx = this.db.transaction((list: string[]) => {
      for (const id of list) {
        factStmt.run(now, id);
        decisionStmt.run(now, id);
      }
    });
    tx(ids);
  }

  // Return all memories created or updated since a given timestamp.
  // Used by `anchor diff --since`.
  diffSince(scopeId: string, since: number): MemoryRow[] {
    const out: MemoryRow[] = [];

    const facts = this.db.prepare(
      `SELECT id, scope_id, source_id, content, superseded_by, language, last_verified_at, created_at, updated_at
       FROM facts WHERE scope_id = ? AND (created_at >= ? OR updated_at >= ?) AND superseded_by IS NULL
       ORDER BY updated_at DESC`
    ).all(scopeId, since, since) as Record<string, unknown>[];
    for (const r of facts) out.push(rowToMemory("fact", r));

    const decisions = this.db.prepare(
      `SELECT id, scope_id, source_id, content, rationale, superseded_by, language, last_verified_at, created_at, updated_at
       FROM decisions WHERE scope_id = ? AND (created_at >= ? OR updated_at >= ?) AND superseded_by IS NULL
       ORDER BY updated_at DESC`
    ).all(scopeId, since, since) as Record<string, unknown>[];
    for (const r of decisions) out.push(rowToMemory("decision", r));

    const episodes = this.db.prepare(
      `SELECT id, scope_id, source_id, summary, files, salience, language, created_at, updated_at
       FROM episodes WHERE scope_id = ? AND (created_at >= ? OR updated_at >= ?)
       ORDER BY updated_at DESC`
    ).all(scopeId, since, since) as Record<string, unknown>[];
    for (const r of episodes) out.push(rowToMemory("episode", r));

    const artifacts = this.db.prepare(
      `SELECT id, scope_id, source_id, ref, note, language, created_at, updated_at
       FROM artifacts WHERE scope_id = ? AND (created_at >= ? OR updated_at >= ?)
       ORDER BY updated_at DESC`
    ).all(scopeId, since, since) as Record<string, unknown>[];
    for (const r of artifacts) out.push(rowToMemory("artifact", r));

    return out.sort((a, b) => a.updatedAt - b.updatedAt);
  }

  // Return episodes and decisions in chronological order for a scope.
  // Used by `anchor replay` to reconstruct a project narrative.
  replay(scopeId: string, limit = 200): MemoryRow[] {
    const out: MemoryRow[] = [];

    const decisions = this.db.prepare(
      `SELECT id, scope_id, source_id, content, rationale, superseded_by, language, last_verified_at, created_at, updated_at
       FROM decisions WHERE scope_id = ? AND superseded_by IS NULL
       ORDER BY created_at ASC LIMIT ?`
    ).all(scopeId, limit) as Record<string, unknown>[];
    for (const r of decisions) out.push(rowToMemory("decision", r));

    const episodes = this.db.prepare(
      `SELECT id, scope_id, source_id, summary, files, salience, language, created_at, updated_at
       FROM episodes WHERE scope_id = ?
       ORDER BY created_at ASC LIMIT ?`
    ).all(scopeId, limit) as Record<string, unknown>[];
    for (const r of episodes) out.push(rowToMemory("episode", r));

    // Interleave chronologically — the whole point of replay.
    return out.sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
  }

  // --- Export / import ---------------------------------------------------

  exportAll(scopeId?: string, opts: { anonymize?: boolean } = {}): ExportPayload {
    const scopeFilter = scopeId ? "WHERE scope_id = ?" : "";
    const params = scopeId ? [scopeId] : [];
    const facts = this.db
      .prepare(`SELECT * FROM facts ${scopeFilter}`)
      .all(...params);
    const decisions = this.db
      .prepare(`SELECT * FROM decisions ${scopeFilter}`)
      .all(...params);
    const episodes = this.db
      .prepare(`SELECT * FROM episodes ${scopeFilter}`)
      .all(...params);
    const artifacts = this.db
      .prepare(`SELECT * FROM artifacts ${scopeFilter}`)
      .all(...params);
    const scopes = scopeId
      ? this.db.prepare("SELECT * FROM scopes WHERE id = ?").all(scopeId)
      : this.db.prepare("SELECT * FROM scopes").all();
    const sources = this.db.prepare("SELECT * FROM sources").all();

    const payload: ExportPayload = {
      version: 1,
      exportedAt: Date.now(),
      scopes: scopes as ScopeRow[],
      sources: sources as SourceRow[],
      facts: facts as RawRow[],
      decisions: decisions as RawRow[],
      episodes: episodes as RawRow[],
      artifacts: artifacts as RawRow[],
    };

    if (opts.anonymize) anonymize(payload);
    return payload;
  }

  // Insert-or-ignore by id. Round-trip safe: re-importing the same payload
  // is a no-op rather than a duplicate.
  importPayload(payload: ExportPayload): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;

    const insertOrIgnore = (
      table: string,
      columns: string[],
      row: Record<string, unknown>
    ) => {
      const placeholders = columns.map(() => "?").join(", ");
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`
      );
      const values = columns.map((c) => row[c] ?? null);
      const r = stmt.run(...values);
      if (r.changes > 0) imported++;
      else skipped++;
    };

    const tx = this.db.transaction(() => {
      for (const s of payload.scopes ?? []) {
        insertOrIgnore("scopes", ["id", "path", "name", "created_at"], s as unknown as Record<string, unknown>);
      }
      for (const s of payload.sources ?? []) {
        insertOrIgnore(
          "sources",
          ["id", "agent", "session_id", "device_id", "created_at"],
          s as unknown as Record<string, unknown>
        );
      }
      for (const r of payload.facts ?? []) {
        insertOrIgnore(
          "facts",
          [
            "id",
            "scope_id",
            "source_id",
            "content",
            "superseded_by",
            "language",
            "created_at",
            "updated_at",
            "last_verified_at",
          ],
          r
        );
      }
      for (const r of payload.decisions ?? []) {
        insertOrIgnore(
          "decisions",
          [
            "id",
            "scope_id",
            "source_id",
            "content",
            "rationale",
            "superseded_by",
            "language",
            "created_at",
            "updated_at",
            "last_verified_at",
          ],
          r
        );
      }
      for (const r of payload.episodes ?? []) {
        insertOrIgnore(
          "episodes",
          [
            "id",
            "scope_id",
            "source_id",
            "summary",
            "files",
            "salience",
            "language",
            "created_at",
            "updated_at",
          ],
          r
        );
      }
      for (const r of payload.artifacts ?? []) {
        insertOrIgnore(
          "artifacts",
          [
            "id",
            "scope_id",
            "source_id",
            "ref",
            "note",
            "language",
            "created_at",
            "updated_at",
          ],
          r
        );
      }
    });
    tx();
    return { imported, skipped };
  }

  close() {
    this.db.close();
  }
}

interface ScopeRow {
  id: string;
  path: string | null;
  name: string;
  created_at: number;
}
interface SourceRow {
  id: string;
  agent: string;
  session_id: string | null;
  device_id: string;
  created_at: number;
}
type RawRow = Record<string, unknown>;

export interface ExportPayload {
  version: 1;
  exportedAt: number;
  scopes: ScopeRow[];
  sources: SourceRow[];
  facts: RawRow[];
  decisions: RawRow[];
  episodes: RawRow[];
  artifacts: RawRow[];
}

// Anonymize an export payload in place. Strips agent/session ids, device ids,
// and absolute paths. Leaves the schema and content intact so the export still
// round-trips on import (with synthetic source/scope ids).
function anonymize(p: ExportPayload): void {
  // Map original source ids to synthetic ones; reuse the same synthetic id
  // across rows so provenance edges are preserved without leaking identity.
  const sourceMap = new Map<string, string>();
  for (let i = 0; i < p.sources.length; i++) {
    const orig = p.sources[i]!;
    const synth = `anon-source-${i}`;
    sourceMap.set(orig.id, synth);
    p.sources[i] = {
      id: synth,
      agent: "anon",
      session_id: null,
      device_id: "anon",
      created_at: 0,
    };
  }

  // Strip absolute paths from scopes; keep synthetic-stable ids.
  for (let i = 0; i < p.scopes.length; i++) {
    const orig = p.scopes[i]!;
    p.scopes[i] = {
      id: orig.id, // hash already; safe to keep so refs resolve
      path: null,
      name: orig.path ? `anon-scope-${i}` : orig.name,
      created_at: 0,
    };
  }

  const stripRow = (r: RawRow) => {
    if ("source_id" in r && typeof r.source_id === "string") {
      r.source_id = sourceMap.get(r.source_id) ?? "anon-source-unknown";
    }
    if ("created_at" in r) r.created_at = 0;
    if ("updated_at" in r) r.updated_at = 0;
    if ("last_verified_at" in r) r.last_verified_at = null;
  };
  p.facts.forEach(stripRow);
  p.decisions.forEach(stripRow);
  p.episodes.forEach(stripRow);
  p.artifacts.forEach(stripRow);
  p.exportedAt = 0;
}

// Score a row for retrieval ranking. Each type has its own decay behaviour:
//   - episodes:  30-day halflife via stored salience (existing logic)
//   - facts:     120-day halflife — stable knowledge fades very slowly
//   - decisions: no time decay — decisions stay relevant until superseded
//   - artifacts: 120-day halflife — reference material, same as facts
// Higher = more relevant.
const HALFLIFE_30D = 30 * 24 * 60 * 60 * 1000;
const HALFLIFE_120D = 120 * 24 * 60 * 60 * 1000;

function rowScore(r: MemoryRow, now: number, activeLanguages?: string[]): number {
  const ageMs = Math.max(0, now - r.updatedAt);
  let base = 1.0;
  switch (r.type) {
    case "episode":
      base = effectiveSalience(r.salience ?? 1, r.updatedAt, now);
      break;
    case "decision":
      // Decisions don't decay — they remain relevant until explicitly superseded.
      base = 1.0;
      break;
    case "fact":
    case "artifact":
      // Slow decay: 120-day halflife keeps stable knowledge around.
      base = 1 / (1 + ageMs / HALFLIFE_120D);
      break;
  }
  // Apply language boost: if the memory's language matches one of the active languages,
  // give it a +0.5 boost!
  if (r.language && activeLanguages && activeLanguages.map(l => l.toLowerCase()).includes(r.language.toLowerCase())) {
    return base + 0.5;
  }
  return base;
}

function rowToMemory(type: MemoryType, r: Record<string, unknown>): MemoryRow {
  const base = {
    id: r["id"] as string,
    type,
    scopeId: r["scope_id"] as string,
    sourceId: r["source_id"] as string,
    createdAt: r["created_at"] as number,
    updatedAt: r["updated_at"] as number,
    supersededBy: (r["superseded_by"] as string | null) ?? undefined,
    language: (r["language"] as string | null) ?? undefined,
  };
  switch (type) {
    case "fact":
      return {
        ...base,
        content: r["content"] as string,
        lastVerifiedAt: (r["last_verified_at"] as number | null) ?? undefined,
      };
    case "decision":
      return {
        ...base,
        content: r["content"] as string,
        rationale: (r["rationale"] as string | null) ?? undefined,
        lastVerifiedAt: (r["last_verified_at"] as number | null) ?? undefined,
      };
    case "episode": {
      const filesRaw = r["files"] as string | null;
      return {
        ...base,
        content: r["summary"] as string,
        files: filesRaw ? (JSON.parse(filesRaw) as string[]) : undefined,
        salience: (r["salience"] as number | null) ?? 1,
      };
    }
    case "artifact":
      return {
        ...base,
        content: ((r["ref"] as string) + (r["note"] ? ` — ${r["note"]}` : "")) as string,
        ref: r["ref"] as string,
        note: (r["note"] as string | null) ?? undefined,
      };
  }
}

// FTS5 query sanitization. We treat the query as bag-of-words and OR them.
// Strips punctuation that has special meaning in FTS5 syntax to avoid throws.
export function sanitizeFtsQuery(q: string): string {
  const tokens = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}
