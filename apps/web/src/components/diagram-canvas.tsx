'use client';

/**
 * diagram-canvas.tsx
 *
 * Infinite pan/zoom canvas for interactive Mermaid diagram editing.
 *
 * Architecture:
 *   - Outer container captures pointer events (pan, zoom, deselect)
 *   - Inner transform wrapper applies CSS translate + scale
 *   - SVG injected inside transform wrapper
 *   - React overlay with node buttons, toolbar, inline editor, ports
 *     also lives inside the same transform wrapper (so coords align)
 *
 * Modes: 'select' (default) | 'connect'
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
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

import type { SvgHitMap, SvgBounds } from '../lib/svg-hit-map';
import type { MutationQueue } from '../lib/diagram-mutations';
import {
  editNodeLabel,
  changeNodeShape,
  addNode,
  removeNode,
  addEdge,
  groupNodes,
  ungroupSubgraph,
} from '../lib/diagram-mutations';

// ── Types ──────────────────────────────────────────────────────

interface DiagramCanvasProps {
  svgContent: string;
  hitMap: SvgHitMap | null;
  mutationQueue: MutationQueue;
  /** Ref to the div we inject SVG into (forwarded from parent for hit-map rebuild) */
  svgContainerRef: RefObject<HTMLDivElement>;
  onError?: (msg: string) => void;
}

type Mode = 'select' | 'connect';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.1;

const SHAPES = [
  'rectangle',
  'rounded',
  'stadium',
  'cylinder',
  'circle',
  'diamond',
  'hexagon',
  'parallelogram',
  'trapezoid',
  'subroutine',
] as const;

// ── Clamp ──────────────────────────────────────────────────────
function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

// ── Derive node shape from SVG class / attributes ──────────────
function inferShape(nodeId: string, svgEl: SVGSVGElement | null): string {
  if (!svgEl) return 'rectangle';
  const el = svgEl.querySelector(`[id^="flowchart-${nodeId}-"]`);
  if (!el) return 'rectangle';
  // Check inner element type
  if (el.querySelector('ellipse')) return 'circle';
  if (el.querySelector('polygon')) return 'diamond';
  const rect = el.querySelector('rect');
  if (rect) {
    const rx = rect.getAttribute('rx');
    if (rx && Number(rx) > 5) return 'rounded';
  }
  return 'rectangle';
}

// ── Component ──────────────────────────────────────────────────

export default function DiagramCanvas({
  svgContent,
  hitMap,
  mutationQueue,
  svgContainerRef,
  onError,
}: DiagramCanvasProps) {
  // ── Canvas transform ───────────────────────────────────────
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1);

  // ── Interaction state ──────────────────────────────────────
  const [mode, setMode] = useState<Mode>('select');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [connectLine, setConnectLine] = useState<{
    x1: number; y1: number; x2: number; y2: number
  } | null>(null);

  // ── Toolbar state ──────────────────────────────────────────
  const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
  const [showShapePicker, setShowShapePicker] = useState(false);

  // ── Inline editor state ────────────────────────────────────
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // cancelRef: set to true in Escape handler so onBlur doesn't commit
  const cancelRef = useRef(false);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // ── Pan tracking ───────────────────────────────────────────
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const isSpaceRef = useRef(false);

  // ── Outer container ref ────────────────────────────────────
  const outerRef = useRef<HTMLDivElement>(null);

  // ── Derived ────────────────────────────────────────────────
  const isEmpty = !svgContent.trim();
  const hasNodes = hitMap && hitMap.nodes.size > 0;
  const singleSelected =
    selectedIds.size === 1 ? [...selectedIds][0]! : null;

  // ──────────────────────────────────────────────────────────
  // SVG injection (dangerouslySetInnerHTML wrapper)
  // ──────────────────────────────────────────────────────────
  // We forward the ref to session-workspace so it can rebuild the hit map.
  // The div is created by us here and also passed as svgContainerRef.

  // ──────────────────────────────────────────────────────────
  // Fit to viewport
  // ──────────────────────────────────────────────────────────
  const fitToViewport = useCallback(() => {
    if (!hitMap || hitMap.nodes.size === 0) return;
    const outer = outerRef.current;
    if (!outer) return;

    const { width: vw, height: vh } = outer.getBoundingClientRect();
    const vb = hitMap.viewBox;
    if (!vb.width || !vb.height) return;

    const scaleX = vw / vb.width;
    const scaleY = vh / vb.height;
    const newZoom = clamp(Math.min(scaleX, scaleY) * 0.9, ZOOM_MIN, ZOOM_MAX);
    const newPanX = (vw - vb.width * newZoom) / 2 - vb.x * newZoom;
    const newPanY = (vh - vb.height * newZoom) / 2 - vb.y * newZoom;

    setZoom(newZoom);
    setPanX(newPanX);
    setPanY(newPanY);
  }, [hitMap]);

  // Fit on first SVG render when we have content
  const hasFitRef = useRef(false);
  useEffect(() => {
    if (svgContent && !hasFitRef.current) {
      hasFitRef.current = true;
      requestAnimationFrame(fitToViewport);
    }
    if (!svgContent) {
      hasFitRef.current = false;
    }
  }, [svgContent, fitToViewport]);

  // ──────────────────────────────────────────────────────────
  // Wheel: zoom to cursor
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      setZoom((prevZoom) => {
        setZoom; // read only to satisfy linter
        const canvasX = (clientX - panX) / prevZoom;
        const canvasY = (clientY - panY) / prevZoom;
        const newZoom = clamp(
          prevZoom * (e.deltaY > 0 ? 0.9 : 1.1),
          ZOOM_MIN,
          ZOOM_MAX,
        );
        setPanX(clientX - canvasX * newZoom);
        setPanY(clientY - canvasY * newZoom);
        return newZoom;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [panX, panY]); // re-bind when pan changes so closure is fresh

  // ──────────────────────────────────────────────────────────
  // Space key tracking
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        isSpaceRef.current = true;
      }

      // Delete selected nodes
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        mode === 'select' &&
        selectedIds.size > 0 &&
        editingNodeId === null
      ) {
        e.preventDefault();
        selectedIds.forEach((id) => removeNode(mutationQueue, id));
        setSelectedIds(new Set());
        setToolbarNodeId(null);
      }

      // Cmd+G — group selected
      if (e.metaKey && !e.shiftKey && e.key === 'g' && selectedIds.size > 0) {
        e.preventDefault();
        const label = prompt('Subgraph label:');
        if (label) {
          groupNodes(mutationQueue, [...selectedIds], label);
        }
      }

      // Cmd+Shift+G — ungroup
      if (e.metaKey && e.shiftKey && e.key === 'g' && singleSelected) {
        e.preventDefault();
        ungroupSubgraph(mutationQueue, singleSelected);
      }

      // Escape: close editor → deselect → return focus
      if (e.key === 'Escape') {
        if (editingNodeId) {
          cancelRef.current = true;
          setEditingNodeId(null);
        } else if (mode === 'connect') {
          setMode('select');
          setConnectSource(null);
          setConnectLine(null);
        } else if (toolbarNodeId) {
          setToolbarNodeId(null);
          setShowShapePicker(false);
        } else if (selectedIds.size > 0) {
          setSelectedIds(new Set());
          outerRef.current?.focus();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') isSpaceRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedIds, editingNodeId, toolbarNodeId, singleSelected, mutationQueue]);

  // ──────────────────────────────────────────────────────────
  // Pan: pointer events on outer container
  // ──────────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const isPanTrigger =
        isSpaceRef.current || e.button === 1; // middle-click

      if (isPanTrigger) {
        e.preventDefault();
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [panX, panY],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) {
      // Update rubber-band connect line
      if (connectSource && connectLine) {
        const outer = outerRef.current;
        if (!outer) return;
        const rect = outer.getBoundingClientRect();
        const cx = (e.clientX - rect.left - panX) / zoom;
        const cy = (e.clientY - rect.top - panY) / zoom;
        setConnectLine((prev) => prev ? { ...prev, x2: cx, y2: cy } : prev);
      }
      return;
    }
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPanX(panStartRef.current.panX + dx);
    setPanY(panStartRef.current.panY + dy);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectSource, connectLine, panX, panY, zoom]);

  const onPointerUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // ──────────────────────────────────────────────────────────
  // Double-click on empty canvas → fit
  // ──────────────────────────────────────────────────────────
  const onDoubleClickCanvas = useCallback(
    (e: React.MouseEvent) => {
      // Only fire if clicking the canvas background (not a node)
      if ((e.target as HTMLElement).closest('[data-nodeid]')) return;
      fitToViewport();
    },
    [fitToViewport],
  );

  // ──────────────────────────────────────────────────────────
  // Click on empty canvas → deselect
  // ──────────────────────────────────────────────────────────
  const onClickCanvas = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-nodeid]')) return;
      if (mode === 'connect') {
        // Cancel connect on background click
        setMode('select');
        setConnectSource(null);
        setConnectLine(null);
        return;
      }
      setSelectedIds(new Set());
      setToolbarNodeId(null);
      setShowShapePicker(false);
    },
    [mode],
  );

  // ──────────────────────────────────────────────────────────
  // Node click handler
  // ──────────────────────────────────────────────────────────
  const onNodeClick = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.stopPropagation();

      if (mode === 'connect') {
        if (!connectSource) {
          // First click: set source
          setConnectSource(nodeId);
          const bounds = hitMap?.nodes.get(nodeId);
          if (bounds) {
            setConnectLine({
              x1: bounds.x + bounds.width / 2,
              y1: bounds.y + bounds.height / 2,
              x2: bounds.x + bounds.width / 2,
              y2: bounds.y + bounds.height / 2,
            });
          }
        } else if (connectSource !== nodeId) {
          // Second click: create edge
          const label = prompt('Edge label (optional):') ?? undefined;
          addEdge(mutationQueue, connectSource, nodeId, label || undefined);
          setMode('select');
          setConnectSource(null);
          setConnectLine(null);
        }
        return;
      }

      // Select mode
      if (e.shiftKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(nodeId)) next.delete(nodeId);
          else next.add(nodeId);
          return next;
        });
        setToolbarNodeId(null);
      } else {
        setSelectedIds(new Set([nodeId]));
        setToolbarNodeId(nodeId);
        setShowShapePicker(false);
      }
    },
    [mode, connectSource, hitMap, mutationQueue],
  );

  // ──────────────────────────────────────────────────────────
  // Node double-click → inline editor
  // ──────────────────────────────────────────────────────────
  const onNodeDblClick = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (mode !== 'select') return;
      if (zoom < 0.4) return; // zoom threshold

      // Extract label from SVG
      const svgEl = svgContainerRef.current?.querySelector<SVGSVGElement>('svg');
      let label = nodeId;
      if (svgEl) {
        const el = svgEl.querySelector(`[id^="flowchart-${nodeId}-"]`);
        const textEl = el?.querySelector<SVGTextElement>('text, foreignObject p, .label');
        if (textEl) label = textEl.textContent?.trim() ?? nodeId;
      }

      cancelRef.current = false;
      setEditValue(label);
      setEditingNodeId(nodeId);
      setToolbarNodeId(null);
      setTimeout(() => {
        inlineInputRef.current?.focus();
        inlineInputRef.current?.select();
      }, 0);
    },
    [mode, zoom, svgContainerRef],
  );

  // ──────────────────────────────────────────────────────────
  // Inline editor commit/cancel
  // ──────────────────────────────────────────────────────────
  const commitEdit = useCallback(() => {
    if (!editingNodeId) return;
    if (!cancelRef.current && editValue.trim()) {
      editNodeLabel(mutationQueue, editingNodeId, editValue.trim());
    }
    cancelRef.current = false;
    setEditingNodeId(null);
  }, [editingNodeId, editValue, mutationQueue]);

  const onInlineKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      }
      if (e.key === 'Escape') {
        cancelRef.current = true;
        setEditingNodeId(null);
      }
    },
    [commitEdit],
  );

  const onInlineBlur = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    commitEdit();
  }, [commitEdit]);

  // ──────────────────────────────────────────────────────────
  // Toolbar actions
  // ──────────────────────────────────────────────────────────
  const onToolbarEdit = (nodeId: string) => {
    onNodeDblClick(nodeId, { stopPropagation: () => {} } as React.MouseEvent);
  };

  const onToolbarShapes = () => {
    setShowShapePicker((v) => !v);
  };

  const onToolbarConnect = () => {
    setMode('connect');
    setToolbarNodeId(null);
    setShowShapePicker(false);
  };

  const onToolbarDelete = (nodeId: string) => {
    removeNode(mutationQueue, nodeId);
    setSelectedIds(new Set());
    setToolbarNodeId(null);
    setShowShapePicker(false);
  };

  const onToolbarAdd = () => {
    addNode(mutationQueue, 'New Node');
  };

  const onShapeSelect = (nodeId: string, shape: string) => {
    changeNodeShape(mutationQueue, nodeId, shape);
    setShowShapePicker(false);
  };

  // ──────────────────────────────────────────────────────────
  // Zoom controls
  // ──────────────────────────────────────────────────────────
  const zoomIn = () => {
    setZoom((z) => clamp(z + ZOOM_STEP, ZOOM_MIN, ZOOM_MAX));
  };
  const zoomOut = () => {
    setZoom((z) => clamp(z - ZOOM_STEP, ZOOM_MIN, ZOOM_MAX));
  };

  // ──────────────────────────────────────────────────────────
  // Toolbar position (above the selected node)
  // ──────────────────────────────────────────────────────────
  function toolbarStyle(bounds: SvgBounds): React.CSSProperties {
    // Place above the node center
    const left = bounds.x + bounds.width / 2;
    const top = bounds.y - 12; // offset above
    return {
      left,
      top,
      transform: 'translateX(-50%) translateY(-100%)',
    };
  }

  // ──────────────────────────────────────────────────────────
  // Inline editor position
  // ──────────────────────────────────────────────────────────
  function inlineEditorStyle(bounds: SvgBounds): React.CSSProperties {
    return {
      left: bounds.x + bounds.width / 2,
      top: bounds.y + bounds.height / 2,
      transform: 'translateX(-50%) translateY(-50%)',
      width: Math.max(80, bounds.width - 8),
    };
  }

  // ──────────────────────────────────────────────────────────
  // Tab-cycle keyboard for node overlays
  // ──────────────────────────────────────────────────────────
  const nodeIds = hitMap ? [...hitMap.nodes.keys()] : [];

  const onNodeKeyDown = useCallback(
    (nodeId: string, e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        setSelectedIds(new Set([nodeId]));
        setToolbarNodeId(nodeId);
      }
    },
    [],
  );

  // ──────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────
  const svgCurrentNode = svgContainerRef.current?.querySelector<SVGSVGElement>('svg') ?? null;

  return (
    <div
      ref={outerRef}
      className="diagram-canvas-outer"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: isSpaceRef.current
          ? 'grab'
          : mode === 'connect'
          ? 'crosshair'
          : 'default',
        userSelect: 'none',
      }}
      role="application"
      aria-label="Diagram canvas"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClickCanvas}
      onDoubleClick={onDoubleClickCanvas}
    >
      {/* ── Transform wrapper: SVG + overlay share this ─── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* SVG */}
        <div
          ref={svgContainerRef}
          dangerouslySetInnerHTML={{ __html: svgContent }}
          style={{ lineHeight: 0 }}
        />

        {/* ── React overlay ──────────────────────────────── */}
        {hitMap && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            {/* Node overlays */}
            {nodeIds.map((nodeId, idx) => {
              const bounds = hitMap.nodes.get(nodeId)!;
              const isSelected = selectedIds.has(nodeId);
              const isSource = connectSource === nodeId;
              const shapeLabel = inferShape(nodeId, svgCurrentNode);

              return (
                <div
                  key={nodeId}
                  data-nodeid={nodeId}
                  className={`node-overlay${isSelected ? ' node-overlay--selected' : ''}${isSource ? ' node-overlay--connect-source' : ''}`}
                  style={{
                    position: 'absolute',
                    left: bounds.x,
                    top: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    pointerEvents: 'all',
                    boxSizing: 'border-box',
                  }}
                  role="button"
                  aria-label={`${shapeLabel}: ${nodeId}`}
                  tabIndex={idx === 0 ? 0 : -1}
                  onClick={(e) => onNodeClick(nodeId, e)}
                  onDoubleClick={(e) => onNodeDblClick(nodeId, e)}
                  onKeyDown={(e) => onNodeKeyDown(nodeId, e)}
                />
              );
            })}

            {/* Connection rubber-band line */}
            {mode === 'connect' && connectLine && (
              <svg
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  overflow: 'visible',
                }}
              >
                <line
                  x1={connectLine.x1}
                  y1={connectLine.y1}
                  x2={connectLine.x2}
                  y2={connectLine.y2}
                  stroke="#38bdf8"
                  strokeWidth={1.5 / zoom}
                  strokeDasharray={`${6 / zoom},${4 / zoom}`}
                />
              </svg>
            )}

            {/* Connect mode port circles on all nodes */}
            {mode === 'connect' &&
              nodeIds.map((nodeId) => {
                const bounds = hitMap.nodes.get(nodeId)!;
                const cx = bounds.x + bounds.width / 2;
                const cy = bounds.y + bounds.height / 2;
                return (
                  <div
                    key={`port-${nodeId}`}
                    className="connect-port"
                    style={{
                      left: cx,
                      top: cy,
                      width: 12 / zoom,
                      height: 12 / zoom,
                      pointerEvents: 'all',
                    }}
                    onClick={(e) => onNodeClick(nodeId, e)}
                  />
                );
              })}

            {/* Contextual toolbar */}
            {toolbarNodeId && hitMap.nodes.has(toolbarNodeId) && mode === 'select' && (
              <>
                <div
                  className="ctx-toolbar"
                  style={toolbarStyle(hitMap.nodes.get(toolbarNodeId)!)}
                >
                  <button
                    className="ctx-btn"
                    title="Edit label"
                    aria-label="Edit node label"
                    onClick={(e) => { e.stopPropagation(); onToolbarEdit(toolbarNodeId); }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="ctx-btn"
                    title="Change shape"
                    aria-label="Change node shape"
                    onClick={(e) => { e.stopPropagation(); onToolbarShapes(); }}
                  >
                    <Shapes size={14} />
                  </button>
                  <button
                    className="ctx-btn"
                    title="Connect to node"
                    aria-label="Connect to another node"
                    onClick={(e) => { e.stopPropagation(); onToolbarConnect(); }}
                  >
                    <ArrowRight size={14} />
                  </button>
                  <button
                    className="ctx-btn ctx-btn--danger"
                    title="Delete node"
                    aria-label="Delete node"
                    onClick={(e) => { e.stopPropagation(); onToolbarDelete(toolbarNodeId); }}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    className="ctx-btn"
                    title="Add node"
                    aria-label="Add new node"
                    onClick={(e) => { e.stopPropagation(); onToolbarAdd(); }}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {/* Shape picker */}
                {showShapePicker && hitMap.nodes.has(toolbarNodeId) && (
                  <div
                    className="shape-picker"
                    style={{
                      left: hitMap.nodes.get(toolbarNodeId)!.x + hitMap.nodes.get(toolbarNodeId)!.width / 2,
                      top: hitMap.nodes.get(toolbarNodeId)!.y - 56,
                      transform: 'translateX(-50%) translateY(-100%)',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {SHAPES.map((shape) => (
                      <button
                        key={shape}
                        className={`shape-btn${inferShape(toolbarNodeId, svgCurrentNode) === shape ? ' shape-btn--active' : ''}`}
                        onClick={() => onShapeSelect(toolbarNodeId, shape)}
                      >
                        {shape}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Inline text editor */}
            {editingNodeId && hitMap.nodes.has(editingNodeId) && (
              <input
                ref={inlineInputRef}
                className="node-inline-input"
                style={inlineEditorStyle(hitMap.nodes.get(editingNodeId)!)}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={onInlineKeyDown}
                onBlur={onInlineBlur}
                onClick={(e) => e.stopPropagation()}
                aria-label="Edit node label"
              />
            )}
          </div>
        )}
      </div>

      {/* ── Empty state (outside transform so it's always centered) */}
      {isEmpty && (
        <div className="empty-state">
          <button
            className="empty-state-btn"
            onClick={() => addNode(mutationQueue, 'Start')}
          >
            + Add your first node
          </button>
        </div>
      )}

      {/* ── Mode hint pill ──────────────────────────────── */}
      <div className="mode-hint">
        {mode === 'connect' ? '⟶ connect mode — click target node' : 'select'}
      </div>

      {/* ── Zoom controls ────────────────────────────────── */}
      <div className="zoom-controls">
        <button className="zoom-btn" onClick={zoomOut} aria-label="Zoom out">
          <ZoomOut size={14} />
        </button>
        <span className="zoom-pct">{Math.round(zoom * 100)}%</span>
        <button className="zoom-btn" onClick={zoomIn} aria-label="Zoom in">
          <ZoomIn size={14} />
        </button>
        <button
          className="zoom-btn"
          onClick={fitToViewport}
          aria-label="Fit to viewport"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}
