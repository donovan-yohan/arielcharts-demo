/**
 * SQLite persistence layer for Yjs documents
 * Stores encoded Yjs document state and activity events
 */

import Database from 'better-sqlite3';
import * as Y from 'yjs';
import { env } from './env.js';
import type { ActivityEvent } from '@arielcharts/shared';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Database schema
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled Diagram',
  yjs_state BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  participant_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('human', 'agent')),
  action TEXT NOT NULL CHECK(action IN ('joined', 'left', 'edited', 'replaced')),
  detail TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_events(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
`;

export interface PersistedSession {
  id: string;
  title: string;
  yjsState: Uint8Array;
  createdAt: number;
  updatedAt: number;
  participantCount: number;
}

export interface SessionListItem {
  id: string;
  title: string;
  participants: number;
  updatedAt: number;
}

class Persistence {
  private db: Database.Database;

  constructor() {
    // Ensure data directory exists
    const dbDir = dirname(env.DATABASE_PATH);
    try {
      mkdirSync(dbDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    this.db = new Database(env.DATABASE_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /**
   * Save or update a session with its Yjs state
   */
  saveSession(
    sessionId: string,
    yjsDoc: Y.Doc,
    title: string = 'Untitled Diagram',
    participantCount: number = 0
  ): void {
    const state = Y.encodeStateAsUpdate(yjsDoc);
    const now = Date.now();

    const stmt = this.db.prepare(
      `INSERT INTO sessions (id, title, yjs_state, created_at, updated_at, participant_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         yjs_state = excluded.yjs_state,
         updated_at = excluded.updated_at,
         participant_count = excluded.participant_count`
    );

    stmt.run(
      sessionId,
      title,
      Buffer.from(state),
      now,
      now,
      participantCount
    );
  }

  /**
   * Load a session's Yjs state
   */
  loadSession(sessionId: string): PersistedSession | null {
    const stmt = this.db.prepare(
      'SELECT id, title, yjs_state, created_at, updated_at, participant_count FROM sessions WHERE id = ?'
    );

    const row = stmt.get(sessionId) as {
      id: string;
      title: string;
      yjs_state: Buffer;
      created_at: number;
      updated_at: number;
      participant_count: number;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      yjsState: new Uint8Array(row.yjs_state),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      participantCount: row.participant_count,
    };
  }

  /**
   * Apply persisted state to a Yjs document
   */
  applyStateToDoc(sessionId: string, yjsDoc: Y.Doc): boolean {
    const session = this.loadSession(sessionId);
    if (session) {
      Y.applyUpdate(yjsDoc, session.yjsState);
      return true;
    }
    return false;
  }

  /**
   * List all sessions ordered by updatedAt desc
   */
  listSessions(limit: number = 100): SessionListItem[] {
    const stmt = this.db.prepare(
      'SELECT id, title, participant_count, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?'
    );

    const rows = stmt.all(limit) as {
      id: string;
      title: string;
      participant_count: number;
      updated_at: number;
    }[];

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      participants: row.participant_count,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Delete a session and its activity events
   */
  deleteSession(sessionId: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(sessionId);
  }

  /**
   * Delete sessions older than a given timestamp
   */
  deleteSessionsOlderThan(timestamp: number): number {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE updated_at < ?');
    const result = stmt.run(timestamp);
    return result.changes;
  }

  /**
   * Record an activity event
   */
  recordActivity(event: ActivityEvent, sessionId: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO activity_events (id, session_id, timestamp, actor_name, actor_type, action, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.run(
      event.id,
      sessionId,
      event.timestamp,
      event.actor.name,
      event.actor.type,
      event.action,
      event.detail ?? null
    );
  }

  /**
   * Get activity events for a session
   */
  getActivityEvents(sessionId: string, limit: number = 50): ActivityEvent[] {
    const stmt = this.db.prepare(
      `SELECT id, timestamp, actor_name, actor_type, action, detail
       FROM activity_events
       WHERE session_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`
    );

    const rows = stmt.all(sessionId, limit) as {
      id: string;
      timestamp: number;
      actor_name: string;
      actor_type: 'human' | 'agent';
      action: 'joined' | 'left' | 'edited' | 'replaced';
      detail: string | null;
    }[];

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      actor: {
        name: row.actor_name,
        type: row.actor_type,
      },
      action: row.action,
      detail: row.detail ?? undefined,
    }));
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// Singleton instance
export const persistence = new Persistence();

// For testing - allows creating isolated instances
export function createPersistence(dbPath: string): Persistence {
  const originalPath = env.DATABASE_PATH;
  (env as { DATABASE_PATH: string }).DATABASE_PATH = dbPath;
  const instance = new Persistence();
  (env as { DATABASE_PATH: string }).DATABASE_PATH = originalPath;
  return instance;
}
