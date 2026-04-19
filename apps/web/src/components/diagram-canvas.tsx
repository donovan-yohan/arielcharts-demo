'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { buildHitMap, type SvgHitMap, type SvgBounds } from '@/lib/svg-hit-map';
import { addNode, removeNode, addEdge, editNodeLabel } from '@/lib/diagram-mutations';
import {
  Pencil,
  Shapes,
  ArrowRight,
  Trash2,
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#161b22',
    primaryTextColor: '#e2e8f0',
    primaryBorderColor: '#30363d',
    lineColor: '#8b949e',
    background: '#0d1117',
  },
  securityLevel: 'loose',
});

const SHAPES = [
  { label: 'Rectangle', open: '[', close: ']' },
  { label: 'Rounded', open: '(', close: ')' },
  { label: 'Stadium', open: '([', close: '])' },
  { label: 'Subroutine', open: '[[', close: ']]' },
  { label: 'Cylinder', open: '[(', close: ')]' },
  { label: 'Circle', open: '((', close: '))' },
  { label: 'Diamond', open: '{', close: '}' },
  { label: 'Hexagon', open: '{{', close: '}}' },
  { label: 'Parallelogram', open: '[/', close: '/]' },
  { label: 'Trapezoid', open: '[\\', close: '\\]' },
];

type InteractionMode = 'select' | 'connect';

interface Props {
  mermaidText: string;
  onMutate: (fn: (text: string) => string) => void;
  sessionId: string;
}

type ToolbarItem = {
  Icon: React.ComponentType<{ size?: number }>;
  title: string;
  act: () => void;
};

export function DiagramCanvas({ mermaidText, onMutate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState('');
  const [hitMap, setHitMap] = useState<SvgHitMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFlowchart, setIsFlowchart] = useState(true);

  const [panX, setPanX] = useState(40);
  const [panY, setPanY] = useState(40);
  const [zoom, setZoom] = useState(1);

  const [mode, setMode] = useState<InteractionMode>('select');
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [connectSource, setConnectSource] = useState<string | null>(null);

  const [showShapePicker, setShowShapePicker] = useState(false);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const renderIdRef = useRef(0);
  const isPanningRef = useRef(false);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const spaceHeld = useRef(false);
  const [spaceActive, setSpaceActive] = useState(false);

  // Render mermaid
  useEffect(() => {
    if (!mermaidText?.trim()) {
      setSvgContent('');
      setHitMap(null);
      return;
    }
    const id = ++renderIdRef.current;
    const timer = setTimeout(async () => {
      if (id !== renderIdRef.current) return;
      try {
        const isFlow = /^\s*(flowchart|graph)\s/m.test(mermaidText);
        setIsFlowchart(isFlow);
        const uid = `mermaid-canvas-${id}`;
        const { svg } = await mermaid.render(uid, mermaidText);
        if (id !== renderIdRef.current) return;
        setError(null);
        setSvgContent(svg);
      } catch (e: unknown) {
        if (id !== renderIdRef.current) return;
        setError((e as Error)?.message ?? 'Invalid diagram');
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [mermaidText]);

  // Build hit map after SVG renders
  useEffect(() => {
    if (!svgContent || !isFlowchart) {
      setHitMap(null);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const svgEl = svgContainerRef.current?.querySelector('svg');
      if (!svgEl) return;
      try {
        setHitMap(buildHitMap(svgEl as SVGSVGElement));
      } catch {
        // ignore hit map errors
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [svgContent, isFlowchart]);

  // Keyboard shortcuts
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !(e.target as HTMLElement)?.matches('input,textarea')
      ) {
        spaceHeld.current = true;
        setSpaceActive(true);
        e.preventDefault();
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedNodes.size > 0 &&
        !editingNode &&
        !(e.target as HTMLElement)?.matches('input,textarea')
      ) {
        selectedNodes.forEach(id => onMutate(t => removeNode(t, id)));
        setSelectedNodes(new Set());
      }
      if (e.key === 'Escape') {
        if (editingNode) {
          setEditingNode(null);
          return;
        }
        if (mode === 'connect') {
          setConnectSource(null);
          setMode('select');
          return;
        }
        if (showShapePicker) {
          setShowShapePicker(false);
          return;
        }
        setSelectedNodes(new Set());
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        setSpaceActive(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [selectedNodes, editingNode, mode, showShapePicker, onMutate]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const canvasX = (cx - panX) / zoom;
      const canvasY = (cy - panY) / zoom;
      const newZoom = Math.min(
        4,
        Math.max(0.1, zoom * (e.deltaY > 0 ? 0.9 : 1.1))
      );
      setPanX(cx - canvasX * newZoom);
      setPanY(cy - canvasY * newZoom);
      setZoom(newZoom);
    },
    [zoom, panX, panY]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || spaceHeld.current) {
      isPanningRef.current = true;
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    setPanX(p => p + e.clientX - lastPanRef.current.x);
    setPanY(p => p + e.clientY - lastPanRef.current.y);
    lastPanRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleNodeClick = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (mode === 'connect') {
        if (!connectSource) {
          setConnectSource(nodeId);
          return;
        }
        if (connectSource !== nodeId) {
          onMutate(t => addEdge(t, connectSource, nodeId));
          setConnectSource(null);
          setMode('select');
        }
        return;
      }
      if (e.shiftKey) {
        setSelectedNodes(prev => {
          const n = new Set(prev);
          n.has(nodeId) ? n.delete(nodeId) : n.add(nodeId);
          return n;
        });
      } else {
        setSelectedNodes(new Set([nodeId]));
      }
      setShowShapePicker(false);
    },
    [mode, connectSource, onMutate]
  );

  const handleNodeDblClick = useCallback(
    (nodeId: string, label: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (mode !== 'select') return;
      setEditingNode(nodeId);
      setEditValue(label);
      setShowShapePicker(false);
    },
    [mode]
  );

  // Guard: only commit if editingNode is still set (not already cancelled)
  const cancelledRef = useRef(false);

  const commitEdit = useCallback(() => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    if (editingNode && editValue.trim()) {
      onMutate(t => editNodeLabel(t, editingNode, editValue.trim()));
    }
    setEditingNode(null);
  }, [editingNode, editValue, onMutate]);

  const handleAddNode = useCallback(() => {
    const nodeId = `n${Date.now()}`;
    onMutate(t => addNode(t, nodeId, 'New Node'));
  }, [onMutate]);

  const getNodeLabel = useCallback(
    (nodeId: string): string => {
      const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = mermaidText.match(
        new RegExp(
          `\\b${escaped}\\s*[\\[\\{\\(>]([^\\]\\}\\)>\\[]*)[\\]\\}\\)>]`
        )
      );
      return m?.[1] ?? nodeId;
    },
    [mermaidText]
  );

  const firstSelected =
    selectedNodes.size === 1 ? Array.from(selectedNodes)[0] : null;
  const firstBounds: SvgBounds | null | undefined = firstSelected
    ? hitMap?.nodes.get(firstSelected)
    : null;

  const isEmpty = !mermaidText?.trim();

  const toolbarItems: ToolbarItem[] = firstSelected
    ? [
        {
          Icon: Pencil,
          title: 'Edit',
          act: () => {
            setEditingNode(firstSelected);
            setEditValue(getNodeLabel(firstSelected));
            setShowShapePicker(false);
          },
        },
        {
          Icon: Shapes,
          title: 'Shape',
          act: () => setShowShapePicker(v => !v),
        },
        {
          Icon: ArrowRight,
          title: 'Connect',
          act: () => {
            setMode('connect');
            setConnectSource(firstSelected);
          },
        },
        {
          Icon: Trash2,
          title: 'Delete',
          act: () => {
            onMutate(t => removeNode(t, firstSelected));
            setSelectedNodes(new Set());
          },
        },
        {
          Icon: Plus,
          title: 'Add node',
          act: handleAddNode,
        },
      ]
    : [];

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#0d1117',
        cursor: spaceActive
          ? 'grab'
          : mode === 'connect'
            ? 'crosshair'
            : 'default',
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={e => {
        if (
          e.target === containerRef.current ||
          e.target === svgContainerRef.current
        ) {
          setSelectedNodes(new Set());
          setShowShapePicker(false);
          if (mode === 'connect') {
            setConnectSource(null);
            setMode('select');
          }
        }
      }}
      onDoubleClick={e => {
        if (e.target === containerRef.current) {
          setZoom(1);
          setPanX(40);
          setPanY(40);
        }
      }}
      role="application"
      aria-label="Diagram canvas"
    >
      {/* Transform wrapper */}
      <div
        style={{
          transform: `translate(${panX}px,${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          userSelect: 'none',
        }}
      >
        <div
          ref={svgContainerRef}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />

        {/* Node overlays */}
        {hitMap &&
          isFlowchart &&
          Array.from(hitMap.nodes.entries()).map(([nodeId, bounds]) => {
            const isSel = selectedNodes.has(nodeId);
            const isSrc = connectSource === nodeId;
            const label = getNodeLabel(nodeId);
            return (
              <div
                key={nodeId}
                style={{
                  position: 'absolute',
                  left: bounds.x,
                  top: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                  pointerEvents: 'auto',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    border: `2px solid ${isSel ? '#38bdf8' : isSrc ? '#22c55e' : 'transparent'}`,
                    borderRadius: 4,
                    boxShadow: isSel
                      ? '0 0 0 2px rgba(56,189,248,0.25)'
                      : 'none',
                    cursor:
                      mode === 'connect' ? 'crosshair' : 'pointer',
                  }}
                  role="button"
                  aria-label={`node: ${label}`}
                  onClick={e => handleNodeClick(nodeId, e)}
                  onDoubleClick={e => handleNodeDblClick(nodeId, label, e)}
                />
                {/* Connection point handles when in connect mode */}
                {mode === 'connect' &&
                  (['left', 'right', 'top', 'bottom'] as const).map(side => (
                    <div
                      key={side}
                      style={{
                        position: 'absolute',
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: '#38bdf8',
                        pointerEvents: 'none',
                        ...(side === 'left'
                          ? { top: '50%', left: -6, transform: 'translateY(-50%)' }
                          : side === 'right'
                            ? { top: '50%', right: -6, transform: 'translateY(-50%)' }
                            : side === 'top'
                              ? { top: -6, left: '50%', transform: 'translateX(-50%)' }
                              : { bottom: -6, left: '50%', transform: 'translateX(-50%)' }),
                      }}
                    />
                  ))}
                {/* Inline label editor */}
                {editingNode === nodeId && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%,-50%)',
                      zIndex: 200,
                    }}
                  >
                    <input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          cancelledRef.current = false;
                          commitEdit();
                        }
                        if (e.key === 'Escape') {
                          cancelledRef.current = true;
                          setEditingNode(null);
                        }
                      }}
                      onBlur={commitEdit}
                      autoFocus
                      style={{
                        background: '#0d1117',
                        border: '1px solid #30363d',
                        borderBottom: '2px solid #38bdf8',
                        borderRadius: 8,
                        padding: '4px 10px',
                        color: '#c9d1d9',
                        fontSize: 13,
                        outline: 'none',
                        minWidth: 100,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Contextual toolbar */}
      {firstSelected && firstBounds && !editingNode && (
        <div
          style={{
            position: 'absolute',
            left:
              panX +
              firstBounds.x * zoom +
              (firstBounds.width * zoom) / 2,
            top: panY + firstBounds.y * zoom - 44,
            transform: 'translateX(-50%)',
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: '4px 8px',
            display: 'flex',
            gap: 4,
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {toolbarItems.map(({ Icon, title, act }) => (
            <button
              key={title}
              title={title}
              onClick={act}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8b949e',
                cursor: 'pointer',
                width: 28,
                height: 28,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={e =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(255,255,255,0.08)')
              }
              onMouseLeave={e =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  'transparent')
              }
            >
              <Icon size={16} />
            </button>
          ))}
          {showShapePicker && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 8,
                padding: 8,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 4,
                zIndex: 200,
                minWidth: 170,
              }}
            >
              {SHAPES.map(shape => (
                <button
                  key={shape.label}
                  onClick={() => {
                    if (!firstSelected) return;
                    const label = getNodeLabel(firstSelected);
                    onMutate(t =>
                      t.replace(
                        new RegExp(
                          `\\b${firstSelected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*)([\\[\\{\\(>\\[](?:[^\\]\\}\\)>]|\\[(?:[^\\]]*)\\])*[\\]\\}\\)>])`,
                          'g'
                        ),
                        `${firstSelected}$1${shape.open}${label}${shape.close}`
                      )
                    );
                    setShowShapePicker(false);
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid #30363d',
                    borderRadius: 6,
                    padding: '4px 8px',
                    color: '#8b949e',
                    cursor: 'pointer',
                    fontSize: 12,
                    textAlign: 'left',
                  }}
                >
                  {shape.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mode hint */}
      {mode === 'connect' && (
        <div
          style={{
            position: 'absolute',
            bottom: 56,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 16,
            padding: '6px 16px',
            color: '#8b949e',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          {connectSource
            ? 'Click target \u2014 Esc to cancel'
            : 'Click source node'}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 8,
            padding: '6px 14px',
            color: '#f87171',
            fontSize: 12,
            maxWidth: '80%',
            zIndex: 50,
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && !error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <button
            onClick={handleAddNode}
            style={{
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 8,
              padding: '12px 24px',
              color: '#8b949e',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            + Add your first node
          </button>
        </div>
      )}

      {/* Non-flowchart notice */}
      {!isFlowchart && svgContent && !error && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'rgba(139,148,158,0.1)',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: '4px 12px',
            color: '#8b949e',
            fontSize: 12,
            zIndex: 50,
          }}
        >
          Read-only (non-flowchart diagram)
        </div>
      )}

      {/* Zoom controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 8,
          overflow: 'hidden',
          zIndex: 50,
        }}
      >
        {(
          [
            {
              Icon: ZoomIn,
              title: 'Zoom in',
              act: () => setZoom(z => Math.min(4, z * 1.2)),
            },
            {
              Icon: Maximize2,
              title: 'Fit',
              act: () => {
                setZoom(1);
                setPanX(40);
                setPanY(40);
              },
            },
            {
              Icon: ZoomOut,
              title: 'Zoom out',
              act: () => setZoom(z => Math.max(0.1, z * 0.8)),
            },
          ] as ToolbarItem[]
        ).map(({ Icon, title, act }) => (
          <button
            key={title}
            title={title}
            onClick={act}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid #30363d',
              color: '#8b949e',
              cursor: 'pointer',
            }}
          >
            <Icon size={14} />
          </button>
        ))}
        <div
          style={{
            padding: '3px 6px',
            textAlign: 'center',
            fontSize: 10,
            color: '#8b949e',
          }}
        >
          {Math.round(zoom * 100)}%
        </div>
      </div>
    </div>
  );
}
