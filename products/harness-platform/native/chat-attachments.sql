CREATE TABLE IF NOT EXISTS deleted_chat_scopes (scope_key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS chat_files (
    scope_key TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    request_id TEXT,
    body BLOB NOT NULL,
    position INTEGER,
    PRIMARY KEY (scope_key, id)
);
CREATE INDEX IF NOT EXISTS chat_files_actor ON chat_files(actor_id);
CREATE INDEX IF NOT EXISTS chat_files_turn ON chat_files(scope_key, request_id);
CREATE INDEX IF NOT EXISTS chat_files_drafts ON chat_files(created_at) WHERE request_id IS NULL;
