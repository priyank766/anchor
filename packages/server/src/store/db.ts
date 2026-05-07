import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import type { AnchorConfig } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

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
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO facts (id, scope_id, source_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, args.scopeId, args.sourceId, args.content, now, now);
    return id;
  }

  insertDecision(args: {
    scopeId: string;
    sourceId: string;
    content: string;
    rationale?: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO decisions (id, scope_id, source_id, content, rationale, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, args.scopeId, args.sourceId, args.content, args.rationale ?? null, now, now);
    return id;
  }

  insertEpisode(args: {
    scopeId: string;
    sourceId: string;
    summary: string;
    files?: string[];
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO episodes (id, scope_id, source_id, summary, files, salience, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1.0, ?, ?)`
      )
      .run(
        id,
        args.scopeId,
        args.sourceId,
        args.summary,
        args.files ? JSON.stringify(args.files) : null,
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
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO artifacts (id, scope_id, source_id, ref, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, args.scopeId, args.sourceId, args.ref, args.note ?? null, now, now);
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

  listByScope(scopeId: string, type?: MemoryType, limit = 100): MemoryRow[] {
    const tables: { type: MemoryType; sql: string }[] = [
      {
        type: "fact",
        sql: `SELECT id, scope_id, source_id, content, superseded_by, created_at, updated_at FROM facts WHERE scope_id = ? AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT ?`,
      },
      {
        type: "decision",
        sql: `SELECT id, scope_id, source_id, content, rationale, superseded_by, created_at, updated_at FROM decisions WHERE scope_id = ? AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT ?`,
      },
      {
        type: "episode",
        sql: `SELECT id, scope_id, source_id, summary, files, salience, created_at, updated_at FROM episodes WHERE scope_id = ? ORDER BY updated_at DESC LIMIT ?`,
      },
      {
        type: "artifact",
        sql: `SELECT id, scope_id, source_id, ref, note, created_at, updated_at FROM artifacts WHERE scope_id = ? ORDER BY updated_at DESC LIMIT ?`,
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
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  searchFTS(scopeId: string, query: string, limit = 50): MemoryRow[] {
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];
    const out: MemoryRow[] = [];

    const facts = this.db
      .prepare(
        `SELECT f.id, f.scope_id, f.source_id, f.content, f.superseded_by, f.created_at, f.updated_at,
                bm25(facts_fts) as rank
         FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid
         WHERE facts_fts MATCH ? AND f.scope_id = ? AND f.superseded_by IS NULL
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, scopeId, limit) as Record<string, unknown>[];
    for (const r of facts) out.push(rowToMemory("fact", r));

    const decisions = this.db
      .prepare(
        `SELECT d.id, d.scope_id, d.source_id, d.content, d.rationale, d.superseded_by, d.created_at, d.updated_at,
                bm25(decisions_fts) as rank
         FROM decisions_fts JOIN decisions d ON d.rowid = decisions_fts.rowid
         WHERE decisions_fts MATCH ? AND d.scope_id = ? AND d.superseded_by IS NULL
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, scopeId, limit) as Record<string, unknown>[];
    for (const r of decisions) out.push(rowToMemory("decision", r));

    const episodes = this.db
      .prepare(
        `SELECT e.id, e.scope_id, e.source_id, e.summary, e.files, e.salience, e.created_at, e.updated_at,
                bm25(episodes_fts) as rank
         FROM episodes_fts JOIN episodes e ON e.rowid = episodes_fts.rowid
         WHERE episodes_fts MATCH ? AND e.scope_id = ?
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, scopeId, limit) as Record<string, unknown>[];
    for (const r of episodes) out.push(rowToMemory("episode", r));

    const artifacts = this.db
      .prepare(
        `SELECT a.id, a.scope_id, a.source_id, a.ref, a.note, a.created_at, a.updated_at,
                bm25(artifacts_fts) as rank
         FROM artifacts_fts JOIN artifacts a ON a.rowid = artifacts_fts.rowid
         WHERE artifacts_fts MATCH ? AND a.scope_id = ?
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, scopeId, limit) as Record<string, unknown>[];
    for (const r of artifacts) out.push(rowToMemory("artifact", r));

    return out;
  }

  // --- Export / import ---------------------------------------------------

  exportAll(scopeId?: string): ExportPayload {
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
    return {
      version: 1,
      exportedAt: Date.now(),
      scopes: scopes as ScopeRow[],
      sources: sources as SourceRow[],
      facts: facts as RawRow[],
      decisions: decisions as RawRow[],
      episodes: episodes as RawRow[],
      artifacts: artifacts as RawRow[],
    };
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

function rowToMemory(type: MemoryType, r: Record<string, unknown>): MemoryRow {
  const base = {
    id: r["id"] as string,
    type,
    scopeId: r["scope_id"] as string,
    sourceId: r["source_id"] as string,
    createdAt: r["created_at"] as number,
    updatedAt: r["updated_at"] as number,
    supersededBy: (r["superseded_by"] as string | null) ?? undefined,
  };
  switch (type) {
    case "fact":
      return { ...base, content: r["content"] as string };
    case "decision":
      return {
        ...base,
        content: r["content"] as string,
        rationale: (r["rationale"] as string | null) ?? undefined,
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
