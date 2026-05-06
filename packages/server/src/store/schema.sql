-- Anchor schema v1
-- Tables are kept narrow. Provenance and scoping are first-class so sync (Phase 3)
-- can be added without rewriting reads.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- A scope isolates memories. Default scope: cwd / git repo root.
CREATE TABLE IF NOT EXISTS scopes (
  id          TEXT PRIMARY KEY,           -- stable hash of path or explicit name
  path        TEXT,                        -- absolute path or NULL for global
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Provenance: which agent/session/timestamp produced each row.
CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  agent       TEXT NOT NULL,               -- e.g. 'claude-code', 'codex', 'cursor'
  session_id  TEXT,
  device_id   TEXT NOT NULL,               -- for future sync
  created_at  INTEGER NOT NULL
);

-- Durable preferences/constraints. "user prefers pnpm".
CREATE TABLE IF NOT EXISTS facts (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES scopes(id),
  source_id     TEXT NOT NULL REFERENCES sources(id),
  content       TEXT NOT NULL,
  superseded_by TEXT REFERENCES facts(id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_verified_at INTEGER
);

-- Choices made, with rationale.
CREATE TABLE IF NOT EXISTS decisions (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES scopes(id),
  source_id     TEXT NOT NULL REFERENCES sources(id),
  content       TEXT NOT NULL,
  rationale     TEXT,
  superseded_by TEXT REFERENCES decisions(id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_verified_at INTEGER
);

-- Compressed task summaries. Decay over time via salience.
CREATE TABLE IF NOT EXISTS episodes (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL REFERENCES scopes(id),
  source_id   TEXT NOT NULL REFERENCES sources(id),
  summary     TEXT NOT NULL,
  files       TEXT,                         -- JSON array of file refs
  salience    REAL NOT NULL DEFAULT 1.0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Pointers to files / symbols / URLs that mattered.
CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL REFERENCES scopes(id),
  source_id   TEXT NOT NULL REFERENCES sources(id),
  ref         TEXT NOT NULL,                -- e.g. 'src/auth/middleware.ts:42'
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- FTS5 virtual tables for BM25 retrieval. We mirror text columns into a single
-- FTS index per memory type so we can rank within a type and merge across types.
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  content, content='facts', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
  content, rationale, content='decisions', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
  summary, content='episodes', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
  ref, note, content='artifacts', content_rowid='rowid', tokenize='porter unicode61'
);

-- Keep FTS in sync via triggers.
CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, content, rationale) VALUES (new.rowid, new.content, new.rationale);
END;
CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, content, rationale) VALUES('delete', old.rowid, old.content, old.rationale);
END;
CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, content, rationale) VALUES('delete', old.rowid, old.content, old.rationale);
  INSERT INTO decisions_fts(rowid, content, rationale) VALUES (new.rowid, new.content, new.rationale);
END;

CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
  INSERT INTO episodes_fts(rowid, summary) VALUES (new.rowid, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, summary) VALUES('delete', old.rowid, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE ON episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, summary) VALUES('delete', old.rowid, old.summary);
  INSERT INTO episodes_fts(rowid, summary) VALUES (new.rowid, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS artifacts_ai AFTER INSERT ON artifacts BEGIN
  INSERT INTO artifacts_fts(rowid, ref, note) VALUES (new.rowid, new.ref, new.note);
END;
CREATE TRIGGER IF NOT EXISTS artifacts_ad AFTER DELETE ON artifacts BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, ref, note) VALUES('delete', old.rowid, old.ref, old.note);
END;
CREATE TRIGGER IF NOT EXISTS artifacts_au AFTER UPDATE ON artifacts BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, ref, note) VALUES('delete', old.rowid, old.ref, old.note);
  INSERT INTO artifacts_fts(rowid, ref, note) VALUES (new.rowid, new.ref, new.note);
END;

CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope_id);
CREATE INDEX IF NOT EXISTS idx_decisions_scope ON decisions(scope_id);
CREATE INDEX IF NOT EXISTS idx_episodes_scope ON episodes(scope_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_scope ON artifacts(scope_id);
