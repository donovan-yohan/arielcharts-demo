import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
import { upsertSession, getSession, listSessions as dbListSessions } from './persistence.js';
import type { Participant } from '@arielcharts/shared';

export interface LiveSession {
  id: string;
  doc: Y.Doc;
  awareness: Map<number, { user: Participant }>;
  participants: number;
}

const sessions = new Map<string, LiveSession>();

export function getOrCreateSession(id: string): LiveSession {
  if (sessions.has(id)) return sessions.get(id)!;

  const doc = new Y.Doc();
  // Try to restore from DB
  const persisted = getSession(id);
  if (persisted?.ydoc_state) {
    Y.applyUpdate(doc, persisted.ydoc_state);
  } else {
    // Bootstrap with a starter diagram
    const text = doc.getText('content');
    doc.transact(() => {
      text.insert(0, 'flowchart TD\n    A[Start] --> B[End]\n');
    });
    persistSession(id, doc);
  }

  const session: LiveSession = { id, doc, awareness: new Map(), participants: 0 };
  sessions.set(id, session);

  doc.on('update', () => persistSession(id, doc));
  return session;
}

function persistSession(id: string, doc: Y.Doc) {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  const text = doc.getText('content').toString();
  const firstLine = text.split('\n')[0] ?? 'Untitled';
  upsertSession(id, firstLine.slice(0, 60) || 'Untitled', state);
}

export function getMermaidText(sessionId: string): string {
  const session = getOrCreateSession(sessionId);
  return session.doc.getText('content').toString();
}

export function setMermaidText(sessionId: string, newText: string): void {
  const session = getOrCreateSession(sessionId);
  const text = session.doc.getText('content');
  session.doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, newText);
  });
}

export function getParticipants(sessionId: string): Participant[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return Array.from(session.awareness.values()).map(a => a.user);
}

export function listAllSessions(): { id: string; title: string; participants: number }[] {
  const persisted = dbListSessions();
  return persisted.map(s => ({
    id: s.id,
    title: s.title,
    participants: sessions.get(s.id)?.participants ?? 0,
  }));
}

export function generateSessionId(): string {
  return uuidv4().replace(/-/g, '').slice(0, 12);
}
