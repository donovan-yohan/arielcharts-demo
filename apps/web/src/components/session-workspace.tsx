'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import mermaid from 'mermaid';
import {
  Share2,
  Copy,
  Check,
  Users,
  Bot,
  Activity,
  X,
  Terminal,
  Sparkles,
} from 'lucide-react';
import type { Participant, AwarenessState, ActivityEvent } from '../../packages/shared/src/types';
import { DiagramCanvas } from './diagram-canvas';
import { MutationQueue } from '@/lib/diagram-mutations';

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  flowchart: {
    useMaxWidth: false,
    htmlLabels: true,
    curve: 'basis',
  },
});

interface SessionWorkspaceProps {
  sessionId: string;
  websocketUrl?: string;
}

const COLORS = [
  '#38bdf8', '#22c55e', '#f472b6', '#fbbf24', '#a78bfa',
  '#fb7185', '#2dd4bf', '#f87171', '#34d399', '#60a5fa',
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function generateColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function SessionWorkspace({
  sessionId,
  websocketUrl = 'ws://localhost:3001',
}: SessionWorkspaceProps) {
  // Yjs state
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const awarenessRef = useRef<any>(null);

  // Editor refs
  const editorRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Mutation queue
  const [mutationQueue, setMutationQueue] = useState<MutationQueue | null>(null);

  // UI state
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [username, setUsername] = useState('');
  const [showUsernamePopover, setShowUsernamePopover] = useState(false);

  // Diagram state
  const [svgContent, setSvgContent] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isFlowchart, setIsFlowchart] = useState(false);

  // Initialize user
  useEffect(() => {
    const stored = localStorage.getItem('arielcharts-username');
    const defaultName = stored || `User ${Math.floor(Math.random() * 1000)}`;
    setUsername(defaultName);
  }, []);

  // Initialize Yjs and WebSocket
  useEffect(() => {
    if (!sessionId || !username) return;

    // Create Yjs document
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // Create WebSocket provider
    const wsUrl = `${websocketUrl}/ws/${sessionId}`;
    const provider = new WebsocketProvider(wsUrl, sessionId, ydoc);
    providerRef.current = provider;

    // Get or create shared text
    const yText = ydoc.getText('mermaid');
    yTextRef.current = yText;

    // Create mutation queue
    const queue = new MutationQueue(yText);
    setMutationQueue(queue);

    // Set up awareness
    const awareness = provider.awareness;
    awarenessRef.current = awareness;

    const color = generateColor(username);
    const user: Participant = {
      name: username,
      color,
      type: 'human',
    };

    awareness.setLocalState({
      user,
      cursor: undefined,
    });

    // Listen for awareness changes
    const updateParticipants = () => {
      const states = Array.from(awareness.getStates().values()) as AwarenessState[];
      const participants = states.map((state) => state.user).filter(Boolean);
      setParticipants(participants);
    };

    awareness.on('change', updateParticipants);
    updateParticipants();

    // Set initial content if empty
    if (yText.length === 0) {
      const initialContent = `flowchart TD
    A[Start] --> B{Is it?}
    B -->|Yes| C[OK]
    C --> D[Rethink]
    D --> B
    B -->|No| E[End]`;
      yText.insert(0, initialContent);
    }

    // Cleanup
    return () => {
      awareness.off('change', updateParticipants);
      queue.dispose();
      provider.disconnect();
      ydoc.destroy();
    };
  }, [sessionId, websocketUrl, username]);

  // Initialize CodeMirror editor
  useEffect(() => {
    if (!editorRef.current || !yTextRef.current || editorViewRef.current) return;

    const yText = yTextRef.current;
    const ydoc = ydocRef.current;
    if (!ydoc) return;

    const undoManager = new Y.UndoManager(yText);

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        basicSetup,
        markdown(),
        yCollab(yText, awarenessRef.current, { undoManager }),
        EditorView.theme({
          '&': {
            height: '100%',
            backgroundColor: '#0d1117',
          },
          '.cm-content': {
            color: '#c9d1d9',
          },
          '.cm-gutters': {
            backgroundColor: '#0d1117',
            borderRight: '1px solid #30363d',
            color: '#8b949e',
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            // Trigger diagram re-render
            renderDiagram(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    editorViewRef.current = view;

    // Listen for remote changes
    yText.observe(() => {
      if (view.state.doc.toString() !== yText.toString()) {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: yText.toString(),
          },
        });
      }
    });

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [yTextRef.current]);

  // Render mermaid diagram
  const renderDiagram = useCallback(async (text: string) => {
    if (!text.trim()) {
      setSvgContent('');
      setIsValid(true);
      setIsFlowchart(false);
      return;
    }

    try {
      // Check if it's a flowchart
      const isFlow = /^\s*(flowchart|graph)\s+/i.test(text);
      setIsFlowchart(isFlow);

      const id = `mermaid-${Date.now()}`;
      const { svg } = await mermaid.render(id, text);
      setSvgContent(svg);
      setIsValid(true);
      setErrorMessage(undefined);
    } catch (error) {
      console.warn('Mermaid render error:', error);
      setIsValid(false);
      setErrorMessage(error instanceof Error ? error.message : 'Invalid diagram');
    }
  }, []);

  // Initial render
  useEffect(() => {
    if (yTextRef.current) {
      renderDiagram(yTextRef.current.toString());
    }
  }, [renderDiagram]);

  // Add activity event
  const addActivity = useCallback((event: Omit<ActivityEvent, 'id' | 'timestamp'>) => {
    const fullEvent: ActivityEvent = {
      ...event,
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
    };
    setActivityEvents((prev) => [fullEvent, ...prev].slice(0, 50));
  }, []);

  // Copy session ID
  const copySessionId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedSessionId(true);
      setTimeout(() => setCopiedSessionId(false), 2000);
    } catch {
      // Ignore copy errors
    }
  }, [sessionId]);

  // Copy agent prompt
  const copyAgentPrompt = useCallback(async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const prompt = `Connect to my ArielCharts session "${sessionId}" using the MCP server at ${origin}/mcp. You can read and write Mermaid diagrams collaboratively in real-time. Look up your docs for how to add an MCP server globally.`;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      // Ignore copy errors
    }
  }, [sessionId]);

  // Update username
  const updateUsername = useCallback((newName: string) => {
    if (!newName.trim()) return;
    setUsername(newName);
    localStorage.setItem('arielcharts-username', newName);

    // Update awareness
    const awareness = awarenessRef.current;
    if (awareness) {
      const color = generateColor(newName);
      const user: Participant = {
        name: newName,
        color,
        type: 'human',
      };
      awareness.setLocalState({
        user,
        cursor: awareness.getLocalState()?.cursor,
      });
    }
    setShowUsernamePopover(false);
  }, []);

  // Format timestamp for activity feed
  const formatTime = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, []);

  // Get user color
  const userColor = useMemo(() => generateColor(username), [username]);

  // Agent prompt for modal
  const agentPrompt = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://arielcharts.example.com';
    return `Connect to my ArielCharts session "${sessionId}" using the MCP server at ${origin}/mcp. You can read and write Mermaid diagrams collaboratively in real-time. Look up your docs for how to add an MCP server globally.`;
  }, [sessionId]);

  return (
    <div className="flex flex-col h-screen bg-deep overflow-hidden">
      {/* Topbar */}
      <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-raised">
        {/* Left: Logo, connect button, session ID */}
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Sparkles size={20} className="text-accent" />
            ArielCharts
          </h1>

          <button
            onClick={() => setShowAgentModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-violet-500 to-blue-500 text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity"
          >
            <Bot size={14} />
            connect my agent
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 bg-deep border border-border rounded-md">
            <code className="text-xs text-secondary font-mono">{sessionId}</code>
            <button
              onClick={copySessionId}
              className="text-secondary hover:text-primary transition-colors"
              title="Copy session ID"
            >
              {copiedSessionId ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Right: Presence avatars, share button */}
        <div className="flex items-center gap-4">
          {/* Presence avatars */}
          <div className="presence-avatars">
            {participants.map((participant, index) => (
              <div
                key={`${participant.name}-${index}`}
                className={`presence-avatar ${participant.type}`}
                style={{
                  backgroundColor: participant.color,
                  zIndex: participants.length - index,
                }}
                title={`${participant.name} (${participant.type})`}
                onClick={() => {
                  if (participant.name === username) {
                    setShowUsernamePopover(true);
                  }
                }}
              >
                {getInitials(participant.name)}
              </div>
            ))}
          </div>

          <button className="flex items-center gap-2 px-3 py-1.5 bg-deep border border-border text-secondary text-sm font-medium rounded-md hover:bg-border transition-colors">
            <Share2 size={14} />
            Share
          </button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor pane (40%) */}
        <div className="w-[40%] flex flex-col border-r border-border">
          <div className="flex items-center justify-between px-3 py-2 bg-raised border-b border-border">
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">
              mermaid source
            </span>
            <span className="text-xs text-accent flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              synced
            </span>
          </div>
          <div ref={editorRef} className="flex-1 overflow-hidden" />
        </div>

        {/* Diagram pane (60%) */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 bg-raised border-b border-border">
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">
              preview
            </span>
            <span className="text-xs text-accent flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              live
            </span>
          </div>
          <div className="flex-1 relative">
            <DiagramCanvas
              svgContent={svgContent}
              isValid={isValid}
              errorMessage={errorMessage}
              isFlowchart={isFlowchart}
              mutationQueue={mutationQueue}
              onActivity={addActivity}
              participants={participants}
            />
          </div>
        </div>
      </div>

      {/* Activity feed */}
      <div className="flex-none max-h-[120px] bg-raised border-t border-border overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-medium text-secondary uppercase tracking-wide flex items-center gap-2">
            <Activity size={12} />
            activity
          </span>
          <span className="text-xs text-secondary">
            {participants.length} collaborator{participants.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {activityEvents.length === 0 ? (
            <div className="text-xs text-secondary text-center py-2">
              No activity yet. Start editing to see events here.
            </div>
          ) : (
            activityEvents.map((event) => (
              <div key={event.id} className="activity-item">
                <span className="activity-timestamp">{formatTime(event.timestamp)}</span>
                <span className={`activity-dot ${event.actor.type}`} />
                <span className="activity-actor">{event.actor.name}</span>
                <span className="activity-action">
                  {event.action}
                  {event.detail && <span className="text-secondary"> • {event.detail}</span>}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Connect Agent Modal */}
      {showAgentModal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAgentModal(false);
          }}
        >
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title flex items-center gap-2">
                <Bot size={20} className="text-accent" />
                Connect your agent
              </h2>
              <button
                className="modal-close"
                onClick={() => setShowAgentModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-secondary mb-4">
              Share this prompt with your AI agent to enable collaborative diagram editing.
            </p>
            <div className="code-block">
              <pre className="whitespace-pre-wrap break-words pr-20">{agentPrompt}</pre>
              <button
                className="code-block-copy"
                onClick={copyAgentPrompt}
              >
                {copiedPrompt ? (
                  <>
                    <Check size={14} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copy
                  </>
                )}
              </button>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-secondary">
              <Terminal size={14} />
              <span>
                MCP server endpoint: <code className="text-accent">/mcp</code>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Username popover */}
      {showUsernamePopover && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setShowUsernamePopover(false)}
        >
          <div
            className="absolute bg-raised border border-border rounded-lg shadow-lg p-3"
            style={{
              top: 48,
              right: 120,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <label className="block text-xs text-secondary mb-1">Display name</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') updateUsername(username);
                  if (e.key === 'Escape') setShowUsernamePopover(false);
                }}
                className="px-2 py-1 bg-deep border border-border rounded text-sm text-primary outline-none focus:border-accent"
                autoFocus
              />
              <button
                onClick={() => updateUsername(username)}
                className="px-3 py-1 bg-accent text-black text-sm font-medium rounded hover:bg-accent-hover transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
