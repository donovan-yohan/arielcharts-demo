import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
import {
  ensureSession,
  persistYjsState,
  restoreYjsState,
  loadSession,
} from './persistence';
import type { ActivityEvent } from '@arielcharts/shared';

/** How long (ms) an idle session with no connections stays in memory before cleanup. */
const IDLE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface ManagedSession {
  doc: Y.Doc;
  connectionCount: number;
  lastActivityAt: number;
  title: string;
}

const sessions = new Map<string, ManagedSession>();

/** Generate a random session ID that matches the required format. */
export function generateSessionId(): string {
  // Use a portion of a UUID (no hyphens) padded to 8 chars, lower-case.
  return uuidv4().replace(/-/g, '').slice(0, 12).toLowerCase();
}

/** Validate a session ID string against allowed format. */
export function isValidSessionId(id: string): boolean {
  return /^[a-z0-9_-]{6,32}$/.test(id);
}

/**
 * Get or create a managed Y.Doc for the given session ID.
 * On first access the doc is restored from SQLite if a snapshot exists.
 */
export function getOrCreateDoc(sessionId: string): Y.Doc {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastActivityAt = Date.now();
    return existing.doc;
  }

  const doc = new Y.Doc();

  // Restore persisted state if available.
  restoreYjsState(sessionId, doc);

  // Read title from persistence layer.
  const row = loadSession(sessionId);
  const title = row?.title ?? sessionId;

  sessions.set(sessionId, {
    doc,
    connectionCount: 0,
    lastActivityAt: Date.now(),
    title,
  });

  return doc;
}

/** Called when a WebSocket client connects to a session. */
export function onConnect(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.connectionCount++;
    session.lastActivityAt = Date.now();
  }
}

/** Called when a WebSocket client disconnects from a session. */
export function onDisconnect(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.connectionCount = Math.max(0, session.connectionCount - 1);
    session.lastActivityAt = Date.now();
  }
}

/** Return current live connection count for a session (0 if not loaded). */
export function getConnectionCount(sessionId: string): number {
  return sessions.get(sessionId)?.connectionCount ?? 0;
}

/** Return the title for a loaded session. */
export function getSessionTitle(sessionId: string): string {
  return sessions.get(sessionId)?.title ?? sessionId;
}

/**
 * Get the Y.Text shared type for mermaid content.
 * Creates the text field if this is the first access.
 */
export function getMermaidText(doc: Y.Doc): Y.Text {
  return doc.getText('mermaid');
}

/**
 * Get the Y.Array shared type for the activity feed.
 */
export function getActivityFeed(doc: Y.Doc): Y.Array<ActivityEvent> {
  return doc.getArray<ActivityEvent>('activityFeed');
}

/**
 * Write new mermaid text into a doc and append an ActivityEvent.
 * Persists the updated state to SQLite.
 */
export function writeMermaidText(
  sessionId: string,
  newText: string,
  actorName: string,
): void {
  const doc = getOrCreateDoc(sessionId);
  const yText = getMermaidText(doc);
  const feed = getActivityFeed(doc);

  const event: ActivityEvent = {
    id: uuidv4(),
    timestamp: Date.now(),
    actor: { name: actorName, type: 'agent' },
    action: 'replaced',
    detail: `Replaced diagram content (${newText.length} chars)`,
  };

  doc.transact(() => {
    yText.delete(0, yText.length);
    yText.insert(0, newText);
    feed.push([event]);
  });

  persistYjsState(sessionId, doc);
}

/**
 * Create a brand-new session: generate ID, insert into DB, initialise doc.
 */
export function createSession(title: string): { id: string; title: string } {
  const id = generateSessionId();
  ensureSession(id, title);
  // Eagerly load the doc into memory.
  getOrCreateDoc(id);
  // Set title on managed session.
  const session = sessions.get(id);
  if (session) session.title = title;
  return { id, title };
}

/**
 * Periodic cleanup: remove in-memory sessions that have had zero connections
 * for longer than IDLE_TTL_MS.  Persists state before evicting.
 */
export function cleanupIdleSessions(): void {
  if (sessions.size === 0) return; // early return — nothing to do

  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.connectionCount > 0) continue; // still has live connections
    if (now - session.lastActivityAt < IDLE_TTL_MS) continue; // not yet idle

    persistYjsState(id, session.doc); // ensure latest state is saved
    sessions.delete(id);
  }
}
