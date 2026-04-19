import Database from 'better-sqlite3';
import * as Y from 'yjs';
import { DB_PATH } from './env';

let db: Database.Database | null = null;

export interface SessionRow {
  id: string;
  title: string;
  yjs_state: Buffer | null;
  updated_at: number;
}

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT '',
        yjs_state  BLOB,
        updated_at INTEGER NOT NULL
      )
    `);
  }
  return db;
}

/** Ensure a session row exists (upsert with no-op on conflict). */
export function ensureSession(id: string, title: string): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO sessions (id, title, yjs_state, updated_at)
       VALUES (?, ?, NULL, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(id, title, Date.now());
}

/** Load all persisted sessions ordered by updated_at desc. */
export function loadAllSessions(): SessionRow[] {
  return getDb()
    .prepare<[], SessionRow>('SELECT id, title, yjs_state, updated_at FROM sessions ORDER BY updated_at DESC')
    .all();
}

/** Load a single session row or null if not found. */
export function loadSession(id: string): SessionRow | null {
  return (
    getDb()
      .prepare<[string], SessionRow>('SELECT id, title, yjs_state, updated_at FROM sessions WHERE id = ?')
      .get(id) ?? null
  );
}

/** Persist the current encoded Yjs state for a session. */
export function persistYjsState(id: string, doc: Y.Doc): void {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  getDb()
    .prepare(
      `INSERT INTO sessions (id, title, yjs_state, updated_at)
       VALUES (?, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET yjs_state = excluded.yjs_state, updated_at = excluded.updated_at`
    )
    .run(id, state, Date.now());
}

/** Restore a Y.Doc from persisted state. Returns false if nothing was stored. */
export function restoreYjsState(id: string, doc: Y.Doc): boolean {
  const row = loadSession(id);
  if (!row || !row.yjs_state) return false;
  Y.applyUpdate(doc, row.yjs_state);
  return true;
}

/** Update only the title of a session. */
export function updateSessionTitle(id: string, title: string): void {
  getDb()
    .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, Date.now(), id);
}

/** Close the database (used in tests / graceful shutdown). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
