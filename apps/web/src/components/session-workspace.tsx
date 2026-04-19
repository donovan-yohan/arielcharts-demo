'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab } from 'y-codemirror.next';
import { Copy, Share2, Sparkles, UserRoundPen } from 'lucide-react';
import { DEFAULT_DIAGRAM, type ActivityEvent, type Participant } from '@arielcharts/shared';
import { DiagramCanvas } from '@/components/diagram-canvas';
import { MutationQueue, parseDiagram, type NodeShape } from '@/lib/diagram-mutations';

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

const SERVER_ORIGIN = process.env.NEXT_PUBLIC_SERVER_ORIGIN ?? 'http://localhost:4000';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function createParticipant(): Participant {
  if (typeof window === 'undefined') {
    return { name: 'You', color: '#58a6ff', type: 'human' };
  }

  const saved = window.localStorage.getItem('arielcharts.participant');
  if (saved) {
    return JSON.parse(saved) as Participant;
  }

  const participant = {
    name: 'You',
    color: '#58a6ff',
    type: 'human' as const,
  };
  window.localStorage.setItem('arielcharts.participant', JSON.stringify(participant));
  return participant;
}

export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const textRef = useRef<Y.Text | null>(null);
  const mutationQueueRef = useRef<MutationQueue | null>(null);
  const [participant, setParticipant] = useState<Participant>({ name: 'You', color: '#58a6ff', type: 'human' });
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [svg, setSvg] = useState('');
  const [lastValidSvg, setLastValidSvg] = useState('');
  const [mermaidText, setMermaidText] = useState(DEFAULT_DIAGRAM);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [editingNodeId, setEditingNodeId] = useState<string | undefined>();
  const [connectSourceId, setConnectSourceId] = useState<string | undefined>();
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState<string | undefined>();

  const parsed = useMemo(() => parseDiagram(mermaidText), [mermaidText]);

  const appendActivity = useCallback((event: ActivityEvent) => {
    setActivity((current) => [...current.slice(-39), event]);
  }, []);

  useEffect(() => {
    const nextParticipant = createParticipant();
    setParticipant(nextParticipant);

    const doc = new Y.Doc();
    const text = doc.getText('mermaid');
    docRef.current = doc;
    textRef.current = text;
    mutationQueueRef.current = new MutationQueue(text);

    const wsUrl = SERVER_ORIGIN.replace(/^http/, 'ws');
    const provider = new WebsocketProvider(`${wsUrl}/ws`, sessionId, doc, {
      connect: true,
      params: {
        userName: nextParticipant.name,
      },
    });

    providerRef.current = provider;
    awarenessRef.current = provider.awareness;
    provider.awareness.setLocalStateField('user', nextParticipant);

    provider.on('status', () => {
      setParticipants(
        Array.from(provider.awareness.getStates().values())
          .map((state) => (state as { user?: Participant }).user)
          .filter(Boolean) as Participant[],
      );
    });

    provider.awareness.on('change', () => {
      setParticipants(
        Array.from(provider.awareness.getStates().values())
          .map((state) => (state as { user?: Participant }).user)
          .filter(Boolean) as Participant[],
      );
    });

    text.observe(() => setMermaidText(text.toString()));

    void fetch(`${SERVER_ORIGIN}/api/sessions/${sessionId}`)
      .then((response) => response.json())
      .then((payload) => {
        setActivity(payload.activity ?? []);
        if (text.length === 0) {
          text.insert(0, payload.diagram?.mermaid_text || DEFAULT_DIAGRAM);
        }
      })
      .catch(() => {
        if (text.length === 0) {
          text.insert(0, DEFAULT_DIAGRAM);
        }
      });

    return () => {
      editorViewRef.current?.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!editorHostRef.current || !textRef.current || !awarenessRef.current || editorViewRef.current) {
      return;
    }

    const undoManager = new Y.UndoManager(textRef.current);
    const state = EditorState.create({
      doc: textRef.current.toString(),
      extensions: [
        lineNumbers(),
        markdown(),
        EditorView.lineWrapping,
        keymap.of([]),
        yCollab(textRef.current, awarenessRef.current, { undoManager }),
        EditorView.theme({
          '&': { height: '100%', color: '#c9d1d9', backgroundColor: '#0d1117' },
          '.cm-content': { fontFamily: 'var(--font-mono)', fontSize: '13px' },
          '.cm-gutters': { backgroundColor: '#0d1117', color: '#484f58', border: 'none' },
          '.cm-cursor': { borderLeftColor: '#38bdf8' },
          '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(56,189,248,0.08)' },
        }),
      ],
    });

    editorViewRef.current = new EditorView({ state, parent: editorHostRef.current });
  }, [mermaidText]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (parsed.kind === 'empty') {
        setSvg('');
        setLastValidSvg('');
        setInvalidMessage(undefined);
        return;
      }

      try {
        const rendered = await mermaid.render(`diagram-${sessionId}`, mermaidText || DEFAULT_DIAGRAM);
        if (!cancelled) {
          setSvg(rendered.svg);
          setLastValidSvg(rendered.svg);
          setInvalidMessage(parsed.kind === 'other' ? 'Non-flowchart diagrams are preview-only in this MVP.' : undefined);
        }
      } catch (error) {
        if (!cancelled) {
          setSvg(lastValidSvg);
          setInvalidMessage(error instanceof Error ? error.message : 'Invalid Mermaid diagram');
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lastValidSvg, mermaidText, parsed.kind, sessionId]);

  const copySessionPrompt = useCallback(async () => {
    await navigator.clipboard.writeText(
      `Connect to my ArielCharts session "${sessionId}" using the MCP server\nat ${SERVER_ORIGIN}/mcp. You can read and write Mermaid diagrams collaboratively\nin real-time. Look up your docs for how to add an MCP server globally.`,
    );
  }, [sessionId]);

  const selectedNodeId = selectedNodeIds[0];

  async function mutate(action: string, run: () => Promise<void>) {
    await run();
    appendActivity({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      actor: { name: participant.name, type: participant.type },
      action: 'edited',
      detail: action,
    });
  }

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">ArielCharts</span>
          <button type="button" className="connect-btn" onClick={() => setConnectModalOpen(true)}>
            <Sparkles size={14} /> connect my agent
          </button>
          <div className="session-chip">
            <span className="session-id">{sessionId}</span>
            <button type="button" className="copy-btn" onClick={() => navigator.clipboard.writeText(window.location.href)}>
              <Copy size={12} />
            </button>
          </div>
        </div>
        <div className="topbar-right">
          <div className="presence-stack">
            {[participant, ...participants.filter((entry) => entry.name !== participant.name)].map((entry, index) => (
              <button
                type="button"
                key={`${entry.name}-${index}`}
                className={`avatar ${entry.type}`}
                style={{ backgroundColor: entry.type === 'human' ? entry.color : 'transparent', color: entry.type === 'human' ? '#fff' : '#3fb950' }}
                onClick={() => {
                  if (index === 0) setRenameOpen((value) => !value);
                }}
              >
                {initials(entry.name)}
              </button>
            ))}
            {renameOpen ? (
              <div className="rename-popover">
                <label>
                  display name
                  <input
                    value={participant.name}
                    onChange={(event) => {
                      const next = { ...participant, name: event.target.value };
                      setParticipant(next);
                      window.localStorage.setItem('arielcharts.participant', JSON.stringify(next));
                      providerRef.current?.awareness.setLocalStateField('user', next);
                    }}
                  />
                </label>
              </div>
            ) : null}
          </div>
          <button type="button" className="share-btn" onClick={() => navigator.clipboard.writeText(window.location.href)}>
            <Share2 size={14} /> Share
          </button>
        </div>
      </header>

      <main className="main-layout">
        <section className="editor-pane">
          <div className="pane-header">
            <span>mermaid source</span>
            <span>synced</span>
          </div>
          <div className="editor-surface" ref={editorHostRef} />
        </section>

        <section className="diagram-pane">
          <div className="pane-header">
            <span>preview</span>
            <span>{parsed.kind === 'flowchart' ? 'live' : 'read-only'}</span>
          </div>
          {parsed.kind === 'empty' ? (
            <div className="empty-state">
              <button
                type="button"
                className="connect-btn"
                onClick={() => mutationQueueRef.current?.addNode()}
              >
                Add your first node
              </button>
            </div>
          ) : (
            <DiagramCanvas
              svg={svg || lastValidSvg}
              parsed={parsed}
              selectedNodeIds={selectedNodeIds}
              selectedNodeId={selectedNodeId}
              connectSourceId={connectSourceId}
              editingNodeId={editingNodeId}
              invalidMessage={invalidMessage}
              onSelectNode={(nodeId, append) => {
                setEditingNodeId(undefined);
                setSelectedNodeIds((current) => (append ? [...new Set([...current, nodeId])] : [nodeId]));
              }}
              onStartEdit={(nodeId) => {
                setSelectedNodeIds([nodeId]);
                setEditingNodeId(nodeId);
              }}
              onCommitEdit={(nodeId, value) => {
                setEditingNodeId(undefined);
                if (!value.trim()) return;
                void mutate(`Renamed ${nodeId}`, async () => mutationQueueRef.current?.editNodeLabel(nodeId, value) ?? Promise.resolve());
              }}
              onCancelEdit={() => {
                setEditingNodeId(undefined);
                setConnectSourceId(undefined);
              }}
              onDeleteSelected={() => {
                const ids = [...selectedNodeIds];
                setSelectedNodeIds([]);
                if (ids.length === 0) return;
                void mutate(`Deleted ${ids.join(', ')}`, async () => mutationQueueRef.current?.removeNodes(ids) ?? Promise.resolve());
              }}
              onAddNode={(afterNodeId) => {
                void mutate(`Added node after ${afterNodeId ?? 'canvas'}`, async () => mutationQueueRef.current?.addNode(afterNodeId) ?? Promise.resolve());
              }}
              onChangeShape={(nodeId, shape: NodeShape) => {
                void mutate(`Changed ${nodeId} to ${shape}`, async () => mutationQueueRef.current?.changeNodeShape(nodeId, shape) ?? Promise.resolve());
              }}
              onToggleConnect={() => {
                setConnectSourceId((current) => (current ? undefined : selectedNodeId));
              }}
              onConnectTarget={(targetNodeId) => {
                if (!connectSourceId) return;
                setConnectSourceId(undefined);
                void mutate(`Connected ${connectSourceId} → ${targetNodeId}`, async () => mutationQueueRef.current?.addEdge(connectSourceId, targetNodeId) ?? Promise.resolve());
              }}
              onFit={() => {
                setSelectedNodeIds([]);
              }}
            />
          )}
        </section>
      </main>

      <section className="activity-pane">
        <div className="pane-header">
          <span>activity</span>
          <span>{participants.length + 1} collaborators</span>
        </div>
        <div className="activity-feed">
          {activity.slice().reverse().map((event) => (
            <div key={event.id} className="activity-item">
              <span className="activity-time">{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className={`activity-dot ${event.actor.type}`} />
              <span className="activity-text">
                <strong>{event.actor.name}</strong> {event.detail ?? event.action}
              </span>
            </div>
          ))}
        </div>
      </section>

      {connectModalOpen ? (
        <div className="modal-backdrop" onClick={() => setConnectModalOpen(false)}>
          <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Connect your agent</span>
              <button type="button" className="modal-close" onClick={() => setConnectModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="prompt-block">
                <pre>{`Connect to my ArielCharts session "${sessionId}" using the MCP server\nat ${SERVER_ORIGIN}/mcp. You can read and write Mermaid diagrams collaboratively\nin real-time. Look up your docs for how to add an MCP server globally.`}</pre>
                <button type="button" className="copy-btn prompt-copy" onClick={copySessionPrompt}>
                  <Copy size={12} /> copy
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
