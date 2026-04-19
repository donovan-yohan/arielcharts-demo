import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  DEFAULT_DIAGRAM,
  MAX_ACTIVITY_EVENTS,
  SESSION_ID_PATTERN,
  type ActivityEvent,
  type Participant,
  type SessionSnapshot,
} from '@arielcharts/shared';
import { Persistence, type PersistedSessionRecord } from './persistence';

interface ManagedSession {
  id: string;
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
  activity: ActivityEvent[];
  updatedAt: number;
  title: string;
  participants: Map<number, Participant>;
}

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(
    private readonly persistence: Persistence,
    private readonly sessionTtlMs: number,
  ) {
    for (const record of persistence.loadAllSessions()) {
      this.sessions.set(record.snapshot.id, this.createSession(record));
    }
  }

  getOrCreateSession(id: string) {
    if (!SESSION_ID_PATTERN.test(id)) {
      throw new Error('invalid_session_id');
    }

    const existing = this.sessions.get(id);
    if (existing) {
      return existing;
    }

    const created = this.createSession({
      snapshot: {
        id,
        mermaidText: DEFAULT_DIAGRAM,
        updatedAt: Date.now(),
        title: 'Untitled flowchart',
        participants: [],
        activity: [],
      },
      ydocState: new Uint8Array(),
    });
    this.sessions.set(id, created);
    this.persist(created);
    return created;
  }

  createSessionId() {
    return nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, 'a');
  }

  listSessions() {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => ({
        id: session.id,
        title: session.title,
        participants: session.participants.size,
      }));
  }

  readDiagram(id: string) {
    const session = this.getOrCreateSession(id);
    return {
      mermaid_text: session.text.toString(),
      participants: [...session.participants.values()],
    };
  }

  writeDiagram(id: string, mermaidText: string, actor: Participant) {
    const session = this.getOrCreateSession(id);
    session.doc.transact(() => {
      session.text.delete(0, session.text.length);
      session.text.insert(0, mermaidText);
    }, 'mcp');
    session.title = inferTitle(mermaidText);
    this.appendActivity(session, {
      id: nanoid(),
      timestamp: Date.now(),
      actor: { name: actor.name, type: actor.type },
      action: 'replaced',
      detail: 'Replaced diagram via MCP',
    });
    this.persist(session);
    return { success: true };
  }

  addActivity(id: string, event: ActivityEvent) {
    const session = this.getOrCreateSession(id);
    this.appendActivity(session, event);
    this.persist(session);
  }

  getActivity(id: string) {
    return this.getOrCreateSession(id).activity;
  }

  getParticipant(id: string, clientId: number) {
    return this.getOrCreateSession(id).participants.get(clientId) ?? null;
  }

  touchParticipant(id: string, clientId: number, participant: Participant | null) {
    const session = this.getOrCreateSession(id);
    if (participant) {
      session.participants.set(clientId, participant);
    } else {
      session.participants.delete(clientId);
    }
    this.persist(session);
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > this.sessionTtlMs && session.participants.size === 0) {
        this.persist(session);
        session.doc.destroy();
        this.sessions.delete(id);
      }
    }
  }

  private createSession(record: PersistedSessionRecord): ManagedSession {
    const { snapshot, ydocState } = record;
    const doc = new Y.Doc();
    if (ydocState.length > 0) {
      Y.applyUpdate(doc, ydocState);
    }

    const text = doc.getText('mermaid');
    if (text.length === 0) {
      text.insert(0, snapshot.mermaidText || DEFAULT_DIAGRAM);
    }

    const awareness = new Awareness(doc);
    const session: ManagedSession = {
      id: snapshot.id,
      doc,
      text,
      awareness,
      activity: snapshot.activity,
      updatedAt: snapshot.updatedAt,
      title: snapshot.title,
      participants: new Map(),
    };

    doc.on('update', () => {
      session.updatedAt = Date.now();
      session.title = inferTitle(session.text.toString());
      this.persist(session);
    });

    return session;
  }

  private appendActivity(session: ManagedSession, event: ActivityEvent) {
    session.activity = [...session.activity.slice(-(MAX_ACTIVITY_EVENTS - 1)), event];
    session.updatedAt = Date.now();
  }

  private persist(session: ManagedSession) {
    this.persistence.saveSession(
      {
        id: session.id,
        mermaidText: session.text.toString(),
        updatedAt: session.updatedAt,
        title: session.title,
        participants: [...session.participants.values()],
        activity: session.activity,
      },
      Y.encodeStateAsUpdate(session.doc),
    );
  }
}

function inferTitle(mermaidText: string) {
  const match = mermaidText.match(/^[^\n]*\n\s*([A-Za-z0-9_]+)(?:\[[^\]]+\]|\(([^)]+)\)|\{([^}]+)\})/m);
  return match?.[2] || match?.[3] || 'Untitled flowchart';
}
