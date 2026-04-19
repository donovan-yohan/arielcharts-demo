'use client';

/**
 * session-workspace.tsx
 *
 * Main workspace component. Wires together:
 * - Yjs CRDT document (y-websocket)
 * - CodeMirror 6 collaborative editor (y-codemirror.next)
 * - Mermaid diagram rendering (dynamic import, SSR=false)
 * - Interactive DiagramCanvas overlay
 * - Presence avatars + awareness
 * - Activity feed
 * - Connect Agent modal
 * - Share button
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { EditorView, lineNumbers, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab } from 'y-codemirror.next';
import { Copy, Check, X, Share2 } from 'lucide-react';

import type { ActivityEvent, AwarenessState, Participant } from '@arielcharts/shared';
import { MutationQueue } from '../lib/diagram-mutations';
import { buildHitMap, isFlowchart } from '../lib/svg-hit-map';
import type { SvgHitMap } from '../lib/svg-hit-map';

// DiagramCanvas is client-only (uses browser APIs)
const DiagramCanvas = dynamic(() => import('./diagram-canvas'), { ssr: false });

// ── Types ──────────────────────────────────────────────────────

interface SessionWorkspaceProps {
  sessionId: string;
}

// ── Default content ────────────────────────────────────────────

const DEFAULT_DIAGRAM = `flowchart TD
    Start([Start]) --> Process[Process Data]
    Process --> Decision{Valid?}
    Decision -->|Yes| Output[Output Result]
    Decision -->|No| Error[Show Error]
    Output --> End([End])
    Error --> End
`;

// ── CodeMirror dark theme ───────────────────────────────────────

const darkTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      background: '#0d1117',
      color: '#c9d1d9',
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: '13px',
    },
    '.cm-scroller': { fontFamily: 'inherit', overflow: 'auto' },
    '.cm-content': { caretColor: '#38bdf8', padding: '8px 0' },
    '.cm-cursor': { borderLeftColor: '#38bdf8' },
    '.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      background: 'rgba(56,189,248,0.20) !important',
    },
    '.cm-gutters': {
      background: '#0d1117',
      borderRight: '1px solid #30363d',
      color: '#484f58',
    },
    '.cm-lineNumbers .cm-gutterElement': { paddingRight: '12px' },
    '.cm-line': { padding: '0 12px' },
    '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
  },
  { dark: true },
);

// ── Helpers ─────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ── Component ──────────────────────────────────────────────────

export default function SessionWorkspace({ sessionId }: SessionWorkspaceProps) {
  // ── Yjs setup ─────────────────────────────────────────────
  const ydocRef = useRef<Y.Doc | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const yFeedRef = useRef<Y.Array<ActivityEvent> | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const mutQueueRef = useRef<MutationQueue | null>(null);

  // ── Editor DOM ref ─────────────────────────────────────────
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // ── Mermaid state ──────────────────────────────────────────
  const [svgContent, setSvgContent] = useState('');
  const [hitMap, setHitMap] = useState<SvgHitMap | null>(null);
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Presence / awareness ───────────────────────────────────
  const [participants, setParticipants] = useState<
    Array<{ clientId: number; user: Participant; isOwn: boolean }>
  >([]);
  const [showNamePopover, setShowNamePopover] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const ownClientIdRef = useRef<number | null>(null);

  // ── Activity feed ──────────────────────────────────────────
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  // ── Connect Agent modal ────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // ── Session chip copy ──────────────────────────────────────
  const [idCopied, setIdCopied] = useState(false);

  // ── Sync status ────────────────────────────────────────────
  const [synced, setSynced] = useState(false);

  // ── mermaid module ref (loaded once) ──────────────────────
  const mermaidRef = useRef<typeof import('mermaid')['default'] | null>(null);

  // ──────────────────────────────────────────────────────────
  // Init: Yjs + WebSocket provider
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    const yFeed = ydoc.getArray<ActivityEvent>('activityFeed');
    ydocRef.current = ydoc;
    ytextRef.current = ytext;
    yFeedRef.current = yFeed;

    const wsUrl =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((globalThis as any)['process']?.env?.['NEXT_PUBLIC_WS_URL'] as string | undefined) ?? 'ws://localhost:3001';
    const provider = new WebsocketProvider(wsUrl, sessionId, ydoc);
    providerRef.current = provider;
    ownClientIdRef.current = ydoc.clientID;

    const mutQueue = new MutationQueue(ytext);
    mutQueueRef.current = mutQueue;

    // Seed default content when empty (after initial sync)
    provider.on('sync', (isSynced: boolean) => {
      setSynced(isSynced);
      if (isSynced && ytext.length === 0) {
        ytext.insert(0, DEFAULT_DIAGRAM);
      }
    });

    // Own awareness
    const savedName = localStorage.getItem('arielcharts:name') ?? 'You';
    const savedColor = localStorage.getItem('arielcharts:color') ?? '#38bdf8';
    setNameInput(savedName);

    provider.awareness.setLocalStateField('user', {
      name: savedName,
      color: savedColor,
      type: 'human',
    } satisfies Participant);

    // Listen for awareness changes
    const onAwareness = () => {
      const states = provider.awareness.getStates() as Map<
        number,
        AwarenessState
      >;
      const list: Array<{ clientId: number; user: Participant; isOwn: boolean }> =
        [];
      states.forEach((state, clientId) => {
        if (!state.user) return;
        list.push({
          clientId,
          user: state.user,
          isOwn: clientId === ydoc.clientID,
        });
      });
      setParticipants(list);
    };
    provider.awareness.on('change', onAwareness);
    onAwareness();

    // Activity feed observer
    const onFeedChange = () => {
      const events = yFeed.toArray();
      setActivityEvents([...events].slice(-50)); // show last 50
    };
    yFeed.observe(onFeedChange);

    return () => {
      provider.awareness.off('change', onAwareness);
      yFeed.unobserve(onFeedChange);
      provider.destroy();
      ydoc.destroy();
    };
    // sessionId won't change after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ──────────────────────────────────────────────────────────
  // Load mermaid once (dynamic import)
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadMermaid() {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          background: '#0d1117',
          mainBkg: '#161b22',
          nodeBorder: '#30363d',
          clusterBkg: '#161b22',
          titleColor: '#e2e8f0',
          edgeLabelBackground: '#161b22',
          lineColor: '#8b949e',
        },
        flowchart: {
          htmlLabels: true,
          curve: 'basis',
        },
        securityLevel: 'loose',
      });
      mermaidRef.current = mermaid;
    }
    void loadMermaid();
  }, []);

  // ──────────────────────────────────────────────────────────
  // Mermaid rendering
  // ──────────────────────────────────────────────────────────
  const renderDiagram = useCallback(async (text: string) => {
    const mermaid = mermaidRef.current;
    if (!mermaid) return;

    const trimmed = text.trim();
    if (!trimmed) {
      setSvgContent('');
      setHitMap(null);
      setMermaidError(null);
      return;
    }

    try {
      const id = `mermaid-svg-${Date.now()}`;
      const { svg } = await mermaid.render(id, trimmed);
      setSvgContent(svg);
      setMermaidError(null);

      // Rebuild hit map after the SVG is in DOM
      requestAnimationFrame(() => {
        const container = svgContainerRef.current;
        if (!container) return;
        const svgEl = container.querySelector<SVGSVGElement>('svg');
        if (!svgEl) return;
        if (isFlowchart(svgEl)) {
          setHitMap(buildHitMap(svgEl));
        } else {
          setHitMap(null);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMermaidError(msg);
      // Keep last valid SVG visible; just show banner
    }
  }, []);

  // ──────────────────────────────────────────────────────────
  // CodeMirror 6 setup
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editorContainerRef.current) return;
    if (editorViewRef.current) return; // already mounted

    // Wait for Yjs to be ready
    const tryMount = () => {
      const ytext = ytextRef.current;
      const provider = providerRef.current;
      if (!ytext || !provider) {
        setTimeout(tryMount, 50);
        return;
      }

      const view = new EditorView({
        state: EditorState.create({
          doc: ytext.toString(),
          extensions: [
            lineNumbers(),
            history(),
            drawSelection(),
            EditorView.lineWrapping,
            markdown(),
            darkTheme,
            yCollab(ytext, provider.awareness),
            // Debounced observer for mermaid re-render
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
              renderTimerRef.current = setTimeout(() => {
                void renderDiagram(update.state.doc.toString());
              }, 150);
            }),
          ],
        }),
        parent: editorContainerRef.current!,
      });

      editorViewRef.current = view;

      // Initial render
      void renderDiagram(ytext.toString());
    };

    tryMount();

    return () => {
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also observe ytext changes from remote (not just local editor)
  useEffect(() => {
    const ytext = ytextRef.current;
    if (!ytext) return;

    const observer = () => {
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
      renderTimerRef.current = setTimeout(() => {
        void renderDiagram(ytext.toString());
      }, 150);
    };

    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [renderDiagram]);

  // ──────────────────────────────────────────────────────────
  // Modal: Connect Agent
  // ──────────────────────────────────────────────────────────
  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const promptText = `Connect to my ArielCharts session "${sessionId}" using the MCP server at ${origin}/mcp. You can read and write Mermaid diagrams collaboratively in real-time. Look up your docs for how to add an MCP server globally.`;

  useEffect(() => {
    if (!showModal) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModal(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    // Move focus into modal
    setTimeout(() => {
      modalRef.current?.focus();
    }, 0);

    return () => document.removeEventListener('keydown', handleKey);
  }, [showModal]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setShowModal(false);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // ──────────────────────────────────────────────────────────
  // Session ID copy
  // ──────────────────────────────────────────────────────────
  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // ──────────────────────────────────────────────────────────
  // Presence: own name popover
  // ──────────────────────────────────────────────────────────
  const saveOwnName = () => {
    const name = nameInput.trim() || 'You';
    localStorage.setItem('arielcharts:name', name);
    const provider = providerRef.current;
    if (provider) {
      const current = provider.awareness.getLocalState() as AwarenessState | null;
      const color = current?.user?.color ?? '#38bdf8';
      provider.awareness.setLocalStateField('user', {
        name,
        color,
        type: 'human',
      } satisfies Participant);
    }
    setShowNamePopover(false);
  };

  // ──────────────────────────────────────────────────────────
  // Derived: mutation queue (stable ref)
  // ──────────────────────────────────────────────────────────
  const mutationQueue = useMemo(() => mutQueueRef.current, []);

  // ──────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────
  const ownParticipant = participants.find((p) => p.isOwn);
  const otherParticipants = participants.filter((p) => !p.isOwn);

  return (
    <div className="workspace">
      {/* ── TOPBAR ─────────────────────────────────────────── */}
      <div className="topbar">
        <div className="topbar-left">
          <span className="logo">ArielCharts</span>

          <button
            className="connect-btn"
            onClick={() => setShowModal(true)}
            aria-label="Connect your agent"
          >
            connect my agent
          </button>

          <div className="session-chip">
            <span className="session-id">{sessionId}</span>
            <button
              className="copy-btn"
              onClick={() => void copySessionId()}
              title="Copy session ID"
              aria-label="Copy session ID"
            >
              {idCopied ? <Check size={10} /> : 'copy'}
            </button>
          </div>
        </div>

        <div className="topbar-right">
          {/* Presence avatars */}
          <div className="presence">
            {/* Others first (behind own) */}
            {otherParticipants.map((p) => (
              <div
                key={p.clientId}
                className={`avatar ${p.user.type === 'agent' ? 'avatar--agent' : 'avatar--human'}`}
                style={
                  p.user.type === 'human'
                    ? { borderColor: p.user.color, background: p.user.color }
                    : undefined
                }
                title={p.user.name}
                aria-label={p.user.name}
              >
                {initials(p.user.name)}
              </div>
            ))}
            {/* Own avatar */}
            {ownParticipant && (
              <div style={{ position: 'relative' }}>
                <div
                  className="avatar avatar--human avatar--own"
                  style={{
                    borderColor: ownParticipant.user.color,
                    background: ownParticipant.user.color,
                  }}
                  title={`${ownParticipant.user.name} (you)`}
                  onClick={() => setShowNamePopover((v) => !v)}
                  role="button"
                  aria-label="Edit your display name"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      setShowNamePopover((v) => !v);
                  }}
                >
                  {initials(ownParticipant.user.name)}
                </div>

                {showNamePopover && (
                  <div className="name-popover">
                    <label htmlFor="name-input">Display name</label>
                    <input
                      id="name-input"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveOwnName();
                        if (e.key === 'Escape') setShowNamePopover(false);
                      }}
                      autoFocus
                    />
                    <div className="name-popover-actions">
                      <button onClick={saveOwnName}>Save</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            className="share-btn"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
            }}
            aria-label="Copy share link"
          >
            <Share2 size={12} style={{ marginRight: 4, display: 'inline' }} />
            Share
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT ──────────────────────────────────── */}
      <div className="main-content">
        {/* Editor Pane */}
        <div className="editor-pane">
          <div className="pane-header">
            <span className="pane-title">mermaid source</span>
            <span className="pane-status">
              {synced ? (
                <>
                  <span className="status-dot" />
                  synced
                </>
              ) : (
                'connecting…'
              )}
            </span>
          </div>
          <div className="codemirror-wrap" ref={editorContainerRef} />
        </div>

        {/* Diagram Pane */}
        <div className="diagram-pane">
          <div className="pane-header">
            <span className="pane-title">preview</span>
            <span className="pane-status">
              <span className="status-dot" />
              live
            </span>
          </div>

          <div className="diagram-canvas-outer">
            {mermaidError && (
              <div className="error-banner" role="alert">
                ⚠ {mermaidError}
              </div>
            )}

            {mutationQueue && (
              <DiagramCanvas
                svgContent={svgContent}
                hitMap={hitMap}
                mutationQueue={mutationQueue}
                svgContainerRef={svgContainerRef}
                onError={(msg) => setMermaidError(msg)}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── ACTIVITY FEED ─────────────────────────────────── */}
      <div className="activity-pane">
        <div className="activity-header">
          <span>activity</span>
          <span>{participants.length} collaborator{participants.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="activity-content" role="log" aria-live="polite">
          {activityEvents.length === 0 ? (
            <div className="activity-item">
              <span className="activity-time">--:--</span>
              <span
                className="activity-dot"
                style={{ background: '#484f58' }}
              />
              <span className="activity-text">No activity yet</span>
            </div>
          ) : (
            activityEvents.map((ev) => (
              <div key={ev.id} className="activity-item">
                <span className="activity-time">{formatTime(ev.timestamp)}</span>
                <span
                  className="activity-dot"
                  style={{
                    background:
                      ev.actor.type === 'agent' ? '#3fb950' : '#38bdf8',
                  }}
                />
                <span className="activity-text">
                  <strong>{ev.actor.name}</strong>
                  {ev.actor.type === 'agent' && (
                    <span className="agent-badge" style={{ margin: '0 4px' }}>
                      agent
                    </span>
                  )}{' '}
                  {ev.action}
                  {ev.detail ? `: ${ev.detail}` : ''}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── CONNECT AGENT MODAL ───────────────────────────── */}
      {showModal && (
        <div
          className="modal-backdrop"
          onClick={handleBackdropClick}
          role="presentation"
        >
          <div
            ref={modalRef}
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            tabIndex={-1}
          >
            <div className="modal-header">
              <span id="modal-title" className="modal-title">
                Connect your agent
              </span>
              <button
                className="modal-close"
                onClick={() => setShowModal(false)}
                aria-label="Close modal"
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal-body">
              <p>
                Paste the following prompt into your AI agent to connect it to
                this session:
              </p>
              <div className="prompt-block">
                <pre aria-label="Agent connection prompt">{promptText}</pre>
                <button
                  className="prompt-copy-btn"
                  onClick={() => void copyPrompt()}
                  aria-label="Copy prompt"
                >
                  {promptCopied ? 'Copied!' : <Copy size={12} />}
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowModal(false)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
