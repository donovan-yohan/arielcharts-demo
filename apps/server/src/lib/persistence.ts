import Database from 'better-sqlite3';
import path from 'path';
import { DATA_DIR } from './env.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(path.join(DATA_DIR, 'arielcharts.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Untitled',
        ydoc_state BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        timestamp INTEGER NOT NULL,
        actor_name TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);
  }
  return db;
}

export function upsertSession(id: string, title: string, ydocState: Buffer): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (id, title, ydoc_state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, ydoc_state = excluded.ydoc_state, updated_at = excluded.updated_at
  `).run(id, title, ydocState, now, now);
}

export function getSession(id: string): { id: string; title: string; ydoc_state: Buffer | null; created_at: number; updated_at: number } | undefined {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
}

export function listSessions(): { id: string; title: string; updated_at: number }[] {
  return getDb().prepare('SELECT id, title, updated_at FROM sessions ORDER BY updated_at DESC').all() as any[];
}

export function appendActivityEvent(sessionId: string, evt: {
  id: string; timestamp: number;
  actor_name: string; actor_type: string;
  action: string; detail?: string;
}): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO activity_events (id, session_id, timestamp, actor_name, actor_type, action, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(evt.id, sessionId, evt.timestamp, evt.actor_name, evt.actor_type, evt.action, evt.detail ?? null);
}
