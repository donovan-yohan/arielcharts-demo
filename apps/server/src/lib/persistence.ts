import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SessionSnapshot } from '@arielcharts/shared';

interface PersistedShape {
  sessions: SessionSnapshot[];
}

export interface PersistedSessionRecord {
  snapshot: SessionSnapshot;
  ydocState: Uint8Array;
}

export class Persistence {
  private readonly database: DatabaseSync;
  private readonly legacyPath: string;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.legacyPath = databasePath.replace(/\.db$/, '.json');
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        mermaid_text TEXT NOT NULL,
        ydoc_state BLOB NOT NULL,
        updated_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        participants_json TEXT NOT NULL,
        activity_json TEXT NOT NULL
      )
    `);
    this.migrateLegacyJsonIfNeeded();
  }

  loadAllSessions(): PersistedSessionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, mermaid_text, ydoc_state, updated_at, title, participants_json, activity_json
         FROM sessions
         ORDER BY updated_at DESC`,
      )
      .all() as unknown as PersistedRow[];

    return rows.map((row) => this.toRecord(row));
  }

  loadSession(id: string): PersistedSessionRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, mermaid_text, ydoc_state, updated_at, title, participants_json, activity_json
         FROM sessions
         WHERE id = ?`,
      )
      .get(id) as unknown as PersistedRow | undefined;

    return row ? this.toRecord(row) : null;
  }

  saveSession(snapshot: SessionSnapshot, ydocState: Uint8Array) {
    this.database
      .prepare(
        `INSERT INTO sessions (id, mermaid_text, ydoc_state, updated_at, title, participants_json, activity_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           mermaid_text = excluded.mermaid_text,
           ydoc_state = excluded.ydoc_state,
           updated_at = excluded.updated_at,
           title = excluded.title,
           participants_json = excluded.participants_json,
           activity_json = excluded.activity_json`,
      )
      .run(
        snapshot.id,
        snapshot.mermaidText,
        Buffer.from(ydocState),
        snapshot.updatedAt,
        snapshot.title,
        JSON.stringify(snapshot.participants),
        JSON.stringify(snapshot.activity),
      );
  }

  private toRecord(row: PersistedRow): PersistedSessionRecord {
    return {
      snapshot: {
        id: row.id,
        mermaidText: row.mermaid_text,
        updatedAt: row.updated_at,
        title: row.title,
        participants: JSON.parse(row.participants_json) as SessionSnapshot['participants'],
        activity: JSON.parse(row.activity_json) as SessionSnapshot['activity'],
      },
      ydocState: new Uint8Array(row.ydoc_state),
    };
  }

  private migrateLegacyJsonIfNeeded() {
    const existingCount = this.database.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    if (existingCount.count > 0 || !fs.existsSync(this.legacyPath)) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(this.legacyPath, 'utf8')) as PersistedShape;
    for (const snapshot of parsed.sessions) {
      this.saveSession(snapshot, new Uint8Array());
    }
  }
}

interface PersistedRow {
  id: string;
  mermaid_text: string;
  ydoc_state: Uint8Array | Buffer;
  updated_at: number;
  title: string;
  participants_json: string;
  activity_json: string;
}
