/**
 * Session manager for Yjs document lifecycle
 * Manages document creation, persistence, cleanup, and activity tracking
 */

import * as Y from 'yjs';
import { persistence } from './persistence.js';
import { config, env } from './env.js';
import type { ActivityEvent, Participant, AwarenessState } from '@arielcharts/shared';
import { randomUUID } from 'crypto';

// Default mermaid template for new sessions
const DEFAULT_MERMAID_TEMPLATE = `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E`;

export interface Session {
  id: string;
  yjsDoc: Y.Doc;
  awareness: Y.Awareness;
  createdAt: number;
  lastActivityAt: number;
  participantCount: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  participants: Participant[];
  mermaidText: string;
}

class SessionManager {
  private sessions = new Map<string, Session>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Validate session ID format
   */
  isValidSessionId(sessionId: string): boolean {
    return config.session.idPattern.test(sessionId);
  }

  /**
   * Get or create a session
   */
  getOrCreateSession(sessionId: string): Session {
    if (!this.isValidSessionId(sessionId)) {
      throw new Error(`Invalid session ID format: ${sessionId}`);
    }

    let session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
      return session;
    }

    // Create new Yjs document
    const yjsDoc = new Y.Doc();
    
    // Try to load persisted state
    const hasPersistedState = persistence.applyStateToDoc(sessionId, yjsDoc);
    
    if (!hasPersistedState) {
      // Initialize with default template
      const yText = yjsDoc.getText('mermaid');
      yText.insert(0, DEFAULT_MERMAID_TEMPLATE);
    }

    // Create awareness
    const awareness = new Y.Awareness(yjsDoc);

    // Set up observer for persistence
    yjsDoc.on('update', (update: Uint8Array, origin: unknown) => {
      // Debounce persistence
      this.debouncedPersist(sessionId);
      
      // Track edits from non-local origins (other clients)
      if (origin !== 'local' && origin !== 'persistence') {
        this.recordEdit(sessionId, origin);
      }
    });

    session = {
      id: sessionId,
      yjsDoc,
      awareness,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      participantCount: 0,
    };

    this.sessions.set(sessionId, session);
    
    // Record session creation as a 'joined' event if new
    if (!hasPersistedState) {
      this.recordActivity(sessionId, {
        id: randomUUID(),
        timestamp: Date.now(),
        actor: { name: 'System', type: 'agent' },
        action: 'joined',
        detail: 'Session created',
      });
    }

    return session;
  }

  /**
   * Get an existing session without creating
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session exists (in memory or persisted)
   */
  sessionExists(sessionId: string): boolean {
    if (this.sessions.has(sessionId)) {
      return true;
    }
    const persisted = persistence.loadSession(sessionId);
    return persisted !== null;
  }

  /**
   * Get session info including mermaid text and participants
   */
  getSessionInfo(sessionId: string): SessionInfo | null {
    const session = this.getOrCreateSession(sessionId);
    const yText = session.yjsDoc.getText('mermaid');
    
    // Get participants from awareness
    const participants: Participant[] = [];
    const seen = new Set<string>();
    
    session.awareness.getStates().forEach((state: unknown) => {
      const awarenessState = state as AwarenessState | undefined;
      if (awarenessState?.user) {
        const key = `${awarenessState.user.name}:${awarenessState.user.type}`;
        if (!seen.has(key)) {
          seen.add(key);
          participants.push(awarenessState.user);
        }
      }
    });

    return {
      id: sessionId,
      title: this.extractTitle(yText.toString()),
      participants,
      mermaidText: yText.toString(),
    };
  }

  /**
   * Write mermaid text to a session
   */
  writeDiagram(sessionId: string, mermaidText: string, actor: { name: string; type: 'human' | 'agent' }): boolean {
    const session = this.getOrCreateSession(sessionId);
    const yText = session.yjsDoc.getText('mermaid');
    
    const oldText = yText.toString();
    if (oldText === mermaidText) {
      return true; // No change needed
    }

    // Apply the new text as a Yjs transaction
    session.yjsDoc.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, mermaidText);
    }, 'persistence');

    // Record the edit activity
    this.recordActivity(sessionId, {
      id: randomUUID(),
      timestamp: Date.now(),
      actor,
      action: 'replaced',
      detail: `Diagram updated by ${actor.name}`,
    });

    // Immediate persistence for explicit writes
    this.persistSession(sessionId);

    return true;
  }

  /**
   * List all sessions (live + persisted)
   */
  listSessions(): { id: string; title: string; participants: number }[] {
    // Get persisted sessions
    const persisted = persistence.listSessions(100);
    
    // Merge with live sessions
    const result = new Map<string, { id: string; title: string; participants: number }>();
    
    for (const session of persisted) {
      result.set(session.id, {
        id: session.id,
        title: session.title,
        participants: session.participants,
      });
    }

    // Override with live session data
    for (const [id, session] of this.sessions) {
      const info = this.getSessionInfo(id);
      if (info) {
        result.set(id, {
          id,
          title: info.title,
          participants: info.participants.length,
        });
      }
    }

    return Array.from(result.values()).sort((a, b) => {
      // Sort by most recently active
      const sessionA = this.sessions.get(a.id);
      const sessionB = this.sessions.get(b.id);
      const timeA = sessionA?.lastActivityAt ?? 0;
      const timeB = sessionB?.lastActivityAt ?? 0;
      return timeB - timeA;
    });
  }

  /**
   * Record participant joined
   */
  recordParticipantJoined(sessionId: string, participant: Participant): void {
    this.recordActivity(sessionId, {
      id: randomUUID(),
      timestamp: Date.now(),
      actor: participant,
      action: 'joined',
    });
    
    const session = this.sessions.get(sessionId);
    if (session) {
      session.participantCount++;
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Record participant left
   */
  recordParticipantLeft(sessionId: string, participant: Participant): void {
    this.recordActivity(sessionId, {
      id: randomUUID(),
      timestamp: Date.now(),
      actor: participant,
      action: 'left',
    });
    
    const session = this.sessions.get(sessionId);
    if (session) {
      session.participantCount = Math.max(0, session.participantCount - 1);
    }
  }

  /**
   * Get activity events for a session
   */
  getActivityEvents(sessionId: string, limit: number = 50): ActivityEvent[] {
    return persistence.getActivityEvents(sessionId, limit);
  }

  /**
   * Persist a session to SQLite
   */
  persistSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const yText = session.yjsDoc.getText('mermaid');
    const title = this.extractTitle(yText.toString());
    
    persistence.saveSession(
      sessionId,
      session.yjsDoc,
      title,
      session.participantCount
    );
  }

  /**
   * Clean up inactive sessions
   */
  cleanupInactiveSessions(): number {
    const now = Date.now();
    const timeout = config.session.inactiveTimeoutMs;
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions) {
      // Skip sessions with active participants
      if (session.participantCount > 0) {
        continue;
      }

      // Check if inactive for too long
      if (now - session.lastActivityAt > timeout) {
        this.persistSession(sessionId);
        session.yjsDoc.destroy();
        session.awareness.destroy();
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Destroy all sessions and cleanup
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Persist all sessions before destroying
    for (const sessionId of this.sessions.keys()) {
      this.persistSession(sessionId);
    }

    for (const session of this.sessions.values()) {
      session.yjsDoc.destroy();
      session.awareness.destroy();
    }
    this.sessions.clear();
  }

  private debounceTimers = new Map<string, NodeJS.Timeout>();

  private debouncedPersist(sessionId: string): void {
    const existing = this.debounceTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.persistSession(sessionId);
      this.debounceTimers.delete(sessionId);
    }, 1000); // 1 second debounce

    this.debounceTimers.set(sessionId, timer);
  }

  private recordEdit(sessionId: string, origin: unknown): void {
    // Try to extract actor info from origin
    let actor: { name: string; type: 'human' | 'agent' } = { name: 'Unknown', type: 'human' };
    
    if (origin && typeof origin === 'object') {
      const o = origin as { user?: Participant };
      if (o.user) {
        actor = o.user;
      }
    }

    this.recordActivity(sessionId, {
      id: randomUUID(),
      timestamp: Date.now(),
      actor,
      action: 'edited',
      detail: 'Document edited',
    });
  }

  private recordActivity(sessionId: string, event: ActivityEvent): void {
    persistence.recordActivity(event, sessionId);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const cleaned = this.cleanupInactiveSessions();
      if (cleaned > 0 && config.isDev) {
        console.log(`Cleaned up ${cleaned} inactive sessions`);
      }
    }, config.session.cleanupIntervalMs);
  }

  private extractTitle(mermaidText: string): string {
    // Try to extract a title from the mermaid text
    // Look for comments or first node label
    const lines = mermaidText.split('\n');
    
    // Check for title comment
    for (const line of lines) {
      const titleMatch = line.match(/^%%\s*Title:\s*(.+)$/i);
      if (titleMatch) {
        return titleMatch[1].trim();
      }
    }
    
    // Extract from first node definition
    const nodeMatch = mermaidText.match(/\[([^\]]+)\]/);
    if (nodeMatch) {
      return nodeMatch[1].trim();
    }
    
    return 'Untitled Diagram';
  }
}

// Singleton instance
export const sessionManager = new SessionManager();

// For testing
export function createSessionManager(): SessionManager {
  return new SessionManager();
}
