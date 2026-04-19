import fs from 'node:fs';
import path from 'node:path';
import type { SessionSnapshot } from '@arielcharts/shared';

interface PersistedShape {
  sessions: SessionSnapshot[];
}

export class Persistence {
  private readonly filePath: string;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.filePath = databasePath.replace(/\.db$/, '.json');
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ sessions: [] } satisfies PersistedShape, null, 2));
    }
  }

  loadAllSessions(): SessionSnapshot[] {
    return this.read().sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  loadSession(id: string): SessionSnapshot | null {
    return this.read().sessions.find((session) => session.id === id) ?? null;
  }

  saveSession(snapshot: SessionSnapshot) {
    const state = this.read();
    const existingIndex = state.sessions.findIndex((session) => session.id === snapshot.id);
    if (existingIndex === -1) {
      state.sessions.push(snapshot);
    } else {
      state.sessions[existingIndex] = snapshot;
    }
    this.write(state);
  }

  private read(): PersistedShape {
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as PersistedShape;
  }

  private write(state: PersistedShape) {
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }
}
