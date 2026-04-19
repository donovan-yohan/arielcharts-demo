'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';
import { markdown } from '@codemirror/lang-markdown';
import { DiagramCanvas } from './diagram-canvas';
import type { ActivityEvent, Participant } from '@arielcharts/shared';
import { v4 as uuidv4 } from 'uuid';
import { Copy, Share2, X } from 'lucide-react';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';

function generateColor(): string {
  const colors = ['#38bdf8', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function ConnectModal({
  sessionId,
  origin,
  onClose,
}: {
  sessionId: string;
  origin: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const prompt = `Connect to my ArielCharts session "${sessionId}" using the MCP server
at ${origin}/mcp. You can read and write Mermaid diagrams collaboratively
in real-time. Look up your docs for how to add an MCP server globally.`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
          padding: 24,
          maxWidth: 500,
          width: '90%',
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'none',
            border: 'none',
            color: '#8b949e',
            cursor: 'pointer',
            lineHeight: 1,
          }}
          aria-label="Close modal"
        >
          <X size={18} />
        </button>
        <h2
          id="connect-modal-title"
          style={{
            color: '#e2e8f0',
            marginBottom: 16,
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          Connect your agent
        </h2>
        <div style={{ position: 'relative' }}>
          <pre
            style={{
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 8,
              padding: '12px 16px',
              color: '#c9d1d9',
              fontSize: 13,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6,
            }}
          >
            {prompt}
          </pre>
          <button
            onClick={() => {
              navigator.clipboard.writeText(prompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '3px 10px',
              color: '#8b949e',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [mermaidText, setMermaidText] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [origin, setOrigin] = useState('');
  const [synced, setSynced] = useState(false);
  const [collaboratorCount, setCollaboratorCount] = useState(0);
  const [displayName, setDisplayName] = useState('User');
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [sessionIdCopied, setSessionIdCopied] = useState(false);
  const userColorRef = useRef(generateColor());

  useEffect(() => {
    setOrigin(window.location.origin);
    const saved =
      localStorage.getItem('arielcharts-name') ??
      `User-${Math.floor(Math.random() * 1000)}`;
    setDisplayName(saved);
    setNameInput(saved);
  }, []);

  useEffect(() => {
    if (!editorRef.current || !displayName) return;

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const yText = ydoc.getText('content');

    const provider = new WebsocketProvider(`${WS_URL}/ws`, sessionId, ydoc);
    providerRef.current = provider;

    provider.awareness.setLocalStateField('user', {
      name: displayName,
      color: userColorRef.current,
      type: 'human',
    } as Participant);

    provider.on('sync', (isSynced: boolean) => {
      setSynced(isSynced);
      if (isSynced) {
        setMermaidText(yText.toString());
        setActivity(prev =>
          [
            {
              id: uuidv4(),
              timestamp: Date.now(),
              actor: { name: displayName, type: 'human' as const },
              action: 'joined' as const,
            },
            ...prev,
          ].slice(0, 50)
        );
      }
    });

    const updateParticipants = () => {
      const states = Array.from(provider.awareness.getStates().values()) as Array<{
        user?: Participant;
      }>;
      const parts: Participant[] = states
        .filter(s => s?.user)
        .map(s => s.user as Participant);
      setParticipants(parts);
      setCollaboratorCount(parts.length);
    };

    provider.awareness.on('change', updateParticipants);

    yText.observe(() => {
      const t = yText.toString();
      setMermaidText(t);
    });

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        basicSetup,
        oneDark,
        markdown(),
        yCollab(yText, provider.awareness),
        EditorView.theme({
          '&': { height: '100%', background: '#0d1117' },
          '.cm-scroller': {
            fontFamily: '"Fira Code", "Cascadia Code", monospace',
            fontSize: '13px',
          },
          '.cm-content': { color: '#c9d1d9' },
          '.cm-gutters': {
            background: '#0d1117',
            borderRight: '1px solid #30363d',
          },
        }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            setActivity(prev =>
              [
                {
                  id: uuidv4(),
                  timestamp: Date.now(),
                  actor: { name: displayName, type: 'human' as const },
                  action: 'edited' as const,
                },
                ...prev,
              ].slice(0, 50)
            );
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    editorViewRef.current = view;

    return () => {
      view.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [sessionId, displayName]);

  const handleMutate = useCallback((mutate: (text: string) => string) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const yText = ydoc.getText('content');
    const currentText = yText.toString();
    const newText = mutate(currentText);
    if (newText === currentText) return;
    import('fast-diff').then(mod => {
      const diff = mod.default;
      const diffs = diff(currentText, newText);
      ydoc.transact(() => {
        let pos = 0;
        for (const [op, text] of diffs) {
          if (op === 0) {
            pos += text.length;
          } else if (op === -1) {
            yText.delete(pos, text.length);
          } else {
            yText.insert(pos, text);
            pos += text.length;
          }
        }
      });
    });
  }, []);

  const handleSaveName = () => {
    if (!nameInput.trim()) return;
    const newName = nameInput.trim();
    setDisplayName(newName);
    localStorage.setItem('arielcharts-name', newName);
    providerRef.current?.awareness.setLocalStateField('user', {
      name: newName,
      color: userColorRef.current,
      type: 'human',
    });
    setShowNameEdit(false);
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#0d1117',
      }}
    >
      {/* TOPBAR */}
      <div
        style={{
          height: 48,
          flexShrink: 0,
          background: '#161b22',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 10,
          position: 'relative',
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: 16,
            color: '#e2e8f0',
            letterSpacing: '-0.5px',
            marginRight: 4,
          }}
        >
          ArielCharts
        </span>

        <button
          onClick={() => setShowConnectModal(true)}
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
            border: 'none',
            borderRadius: 6,
            padding: '5px 14px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          connect my agent
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '4px 10px',
          }}
        >
          <code style={{ color: '#8b949e', fontSize: 12 }}>{sessionId}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(sessionId);
              setSessionIdCopied(true);
              setTimeout(() => setSessionIdCopied(false), 2000);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
            }}
            title="Copy session ID"
          >
            <Copy size={13} />
          </button>
          {sessionIdCopied && (
            <span style={{ color: '#38bdf8', fontSize: 11 }}>✓</span>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Presence avatars */}
        <div
          style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
        >
          {participants.slice(0, 6).map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              title={p.name}
              onClick={i === 0 ? () => setShowNameEdit(v => !v) : undefined}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: p.color ?? '#38bdf8',
                border:
                  p.type === 'agent'
                    ? '2px dashed #22c55e'
                    : '2px solid rgba(255,255,255,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                color: '#fff',
                marginLeft: i === 0 ? 0 : -10,
                cursor: i === 0 ? 'pointer' : 'default',
                zIndex: 10 - i,
                position: 'relative',
                userSelect: 'none',
              }}
            >
              {getInitials(p.name)}
            </div>
          ))}
          {participants.length > 6 && (
            <div
              style={{
                marginLeft: -10,
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: '#30363d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: '#8b949e',
                zIndex: 5,
                position: 'relative',
              }}
            >
              +{participants.length - 6}
            </div>
          )}
        </div>

        {/* Name edit popover */}
        {showNameEdit && (
          <div
            style={{
              position: 'absolute',
              top: 52,
              right: 60,
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 8,
              padding: 12,
              zIndex: 500,
              display: 'flex',
              gap: 8,
            }}
          >
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') setShowNameEdit(false);
                e.stopPropagation();
              }}
              style={{
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: '6px 10px',
                color: '#e2e8f0',
                fontSize: 13,
                outline: 'none',
                width: 160,
              }}
              autoFocus
              placeholder="Display name"
            />
            <button
              onClick={handleSaveName}
              style={{
                background: '#38bdf8',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                color: '#000',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Save
            </button>
          </div>
        )}

        <button
          style={{
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '5px 12px',
            color: '#8b949e',
            cursor: 'pointer',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
          }}
        >
          <Share2 size={14} /> Share
        </button>
      </div>

      {/* MAIN PANES */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Editor Pane */}
        <div
          style={{
            width: '40%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #30363d',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: 36,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              gap: 8,
              borderBottom: '1px solid #30363d',
              background: '#161b22',
            }}
          >
            <span
              style={{ fontSize: 12, color: '#8b949e', fontWeight: 500 }}
            >
              mermaid source
            </span>
            <span
              style={{
                fontSize: 11,
                color: synced ? '#22c55e' : '#8b949e',
                background: '#0d1117',
                padding: '2px 7px',
                borderRadius: 4,
                border: '1px solid #30363d',
              }}
            >
              {synced ? 'synced' : 'connecting\u2026'}
            </span>
          </div>
          <div
            ref={editorRef}
            style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}
          />
        </div>

        {/* Diagram Pane */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: 36,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              gap: 8,
              borderBottom: '1px solid #30363d',
              background: '#161b22',
            }}
          >
            <span
              style={{ fontSize: 12, color: '#8b949e', fontWeight: 500 }}
            >
              preview
            </span>
            <span
              style={{
                fontSize: 11,
                color: '#22c55e',
                background: '#0d1117',
                padding: '2px 7px',
                borderRadius: 4,
                border: '1px solid #30363d',
              }}
            >
              live
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: '#8b949e' }}>
              {collaboratorCount} collaborator
              {collaboratorCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              position: 'relative',
              minHeight: 0,
            }}
          >
            <DiagramCanvas
              mermaidText={mermaidText}
              onMutate={handleMutate}
              sessionId={sessionId}
            />
          </div>
        </div>
      </div>

      {/* ACTIVITY FEED */}
      <div
        style={{
          flexShrink: 0,
          maxHeight: 120,
          borderTop: '1px solid #30363d',
          background: '#161b22',
          overflowY: 'auto',
          padding: '6px 14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 500 }}>
            activity
          </span>
          <span
            style={{
              fontSize: 11,
              color: '#8b949e',
              background: '#0d1117',
              padding: '1px 6px',
              borderRadius: 4,
            }}
          >
            {collaboratorCount} collaborator{collaboratorCount !== 1 ? 's' : ''}
          </span>
        </div>
        {activity.length === 0 ? (
          <div
            style={{ fontSize: 12, color: '#8b949e', fontStyle: 'italic' }}
          >
            No activity yet
          </div>
        ) : (
          activity.map(evt => (
            <div
              key={evt.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                paddingBottom: 3,
              }}
            >
              <span
                style={{
                  color: '#8b949e',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  flexShrink: 0,
                }}
              >
                {formatTime(evt.timestamp)}
              </span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background:
                    evt.actor.type === 'agent' ? '#22c55e' : '#38bdf8',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: '#e2e8f0' }}>{evt.actor.name}</span>
              <span style={{ color: '#8b949e' }}>{evt.action}</span>
              {evt.detail && (
                <span style={{ color: '#8b949e', fontStyle: 'italic' }}>
                  {evt.detail}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {showConnectModal && (
        <ConnectModal
          sessionId={sessionId}
          origin={origin}
          onClose={() => setShowConnectModal(false)}
        />
      )}
    </div>
  );
}
