'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Expand, Minus, Pencil, Plus, Shapes, Trash2, X } from 'lucide-react';
import type { ParsedDiagram, ParsedNode, NodeShape } from '@/lib/diagram-mutations';
import { buildSvgHitMap, type SvgHitMap } from '@/lib/svg-hit-map';

const shapes: NodeShape[] = ['rect', 'round', 'stadium', 'subroutine', 'diamond', 'circle'];

interface DiagramCanvasProps {
  svg: string;
  parsed: ParsedDiagram;
  selectedNodeIds: string[];
  selectedNodeId?: string;
  connectSourceId?: string;
  editingNodeId?: string;
  onSelectNode: (nodeId: string, append: boolean) => void;
  onStartEdit: (nodeId: string) => void;
  onCommitEdit: (nodeId: string, value: string) => void;
  onCancelEdit: () => void;
  onDeleteSelected: () => void;
  onAddNode: (afterNodeId?: string) => void;
  onChangeShape: (nodeId: string, shape: NodeShape) => void;
  onToggleConnect: () => void;
  onConnectTarget: (targetNodeId: string) => void;
  onFit: () => void;
  invalidMessage?: string;
}

export function DiagramCanvas(props: DiagramCanvasProps) {
  const {
    svg,
    parsed,
    selectedNodeIds,
    selectedNodeId,
    connectSourceId,
    editingNodeId,
    onSelectNode,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    onDeleteSelected,
    onAddNode,
    onChangeShape,
    onToggleConnect,
    onConnectTarget,
    onFit,
    invalidMessage,
  } = props;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [hitMap, setHitMap] = useState<SvgHitMap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  useEffect(() => {
    setShapePickerOpen(false);
    requestAnimationFrame(() => {
      const svgElement = canvasRef.current?.querySelector('svg') as SVGSVGElement | null;
      setHitMap(buildSvgHitMap(svgElement));
    });
  }, [svg]);

  useEffect(() => {
    if (!editingNodeId) {
      setDraftLabel('');
      return;
    }
    const node = parsed.nodes.find((item) => item.id === editingNodeId);
    setDraftLabel(node?.label ?? '');
  }, [editingNodeId, parsed.nodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeIds.length > 0) {
          event.preventDefault();
          onDeleteSelected();
        }
      }
      if (event.key === 'Escape') {
        onCancelEdit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancelEdit, onDeleteSelected, selectedNodeIds.length]);

  const selectedNode = useMemo(
    () => parsed.nodes.find((node) => node.id === selectedNodeId),
    [parsed.nodes, selectedNodeId],
  );

  function changeZoom(nextZoom: number, center?: { clientX: number; clientY: number }) {
    const clamped = Math.max(0.1, Math.min(4, nextZoom));
    if (!center || !shellRef.current) {
      setZoom(clamped);
      return;
    }

    const rect = shellRef.current.getBoundingClientRect();
    const localX = center.clientX - rect.left;
    const localY = center.clientY - rect.top;
    const canvasX = (localX - pan.x) / zoom;
    const canvasY = (localY - pan.y) / zoom;
    setZoom(clamped);
    setPan({
      x: localX - canvasX * clamped,
      y: localY - canvasY * clamped,
    });
  }

  return (
    <div
      className={`diagram-shell ${connectSourceId ? 'is-connect-mode' : ''}`}
      ref={shellRef}
      onWheel={(event) => {
        event.preventDefault();
        changeZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1), { clientX: event.clientX, clientY: event.clientY });
      }}
      onDoubleClick={(event) => {
        if (event.target === shellRef.current) {
          onFit();
          setPan({ x: 40, y: 40 });
          setZoom(1);
        }
      }}
      onMouseDown={(event) => {
        if (event.button === 1 || event.button === 0 && event.shiftKey) {
          setPanning(true);
          panStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
        }
      }}
      onMouseMove={(event) => {
        if (!panning) return;
        const dx = event.clientX - panStartRef.current.x;
        const dy = event.clientY - panStartRef.current.y;
        setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
      }}
      onMouseUp={() => setPanning(false)}
      onMouseLeave={() => setPanning(false)}
      role="application"
      aria-label="diagram canvas"
    >
      {invalidMessage ? <div className="error-banner">{invalidMessage}</div> : null}
      <div className="canvas-transform" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <div className="svg-stage" ref={canvasRef} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="overlay-stage">
          {[...(hitMap?.nodes.entries() ?? [])].map(([nodeId, bounds]) => {
            const node = parsed.nodes.find((item) => item.id === nodeId);
            if (!node) return null;
            const selected = selectedNodeIds.includes(nodeId);
            const editing = editingNodeId === nodeId;
            return (
              <button
                key={nodeId}
                type="button"
                className={`node-overlay ${selected ? 'selected' : ''} ${connectSourceId === nodeId ? 'connect-source' : ''}`}
                style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (connectSourceId && connectSourceId !== nodeId) {
                    onConnectTarget(nodeId);
                    return;
                  }
                  onSelectNode(nodeId, event.shiftKey);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onStartEdit(nodeId);
                }}
                role="button"
                aria-label={`${node.shape}: ${node.label}`}
              >
                {editing && zoom >= 0.4 ? (
                  <form
                    className="inline-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onCommitEdit(nodeId, draftLabel);
                    }}
                  >
                    <input
                      autoFocus
                      value={draftLabel}
                      onChange={(event) => setDraftLabel(event.target.value)}
                      onBlur={() => onCommitEdit(nodeId, draftLabel)}
                    />
                    <button type="button" onClick={onCancelEdit} aria-label="Cancel edit">
                      <X size={12} />
                    </button>
                  </form>
                ) : null}
              </button>
            );
          })}
          {selectedNode && selectedNodeId && hitMap?.nodes.get(selectedNodeId) ? (
            <div
              className="context-toolbar"
              style={{
                left: hitMap.nodes.get(selectedNodeId)!.x + hitMap.nodes.get(selectedNodeId)!.width / 2,
                top: hitMap.nodes.get(selectedNodeId)!.y - 12,
              }}
            >
              <button type="button" className="toolbar-btn" onClick={() => onStartEdit(selectedNodeId)} aria-label="Edit label">
                <Pencil size={14} />
              </button>
              <button type="button" className="toolbar-btn" onClick={() => setShapePickerOpen((value) => !value)} aria-label="Change shape">
                <Shapes size={14} />
              </button>
              <button type="button" className="toolbar-btn" onClick={onToggleConnect} aria-label="Connect node">
                <ArrowRight size={14} />
              </button>
              <button type="button" className="toolbar-btn" onClick={onDeleteSelected} aria-label="Delete node">
                <Trash2 size={14} />
              </button>
              <button type="button" className="toolbar-btn" onClick={() => onAddNode(selectedNodeId)} aria-label="Add node">
                <Plus size={14} />
              </button>
              {shapePickerOpen ? (
                <div className="shape-picker">
                  {shapes.map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      className={`shape-option ${selectedNode.shape === shape ? 'active' : ''}`}
                      onClick={() => {
                        onChangeShape(selectedNodeId, shape);
                        setShapePickerOpen(false);
                      }}
                    >
                      {shape}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mode-pill">{connectSourceId ? 'connect mode: click target node' : 'select mode'}</div>
      <div className="zoom-controls">
        <button type="button" className="toolbar-btn" onClick={() => changeZoom(zoom * 0.9)} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" className="toolbar-btn" onClick={() => changeZoom(zoom * 1.1)} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button type="button" className="toolbar-btn" onClick={() => { setPan({ x: 40, y: 40 }); setZoom(1); onFit(); }} aria-label="Fit diagram">
          <Expand size={14} />
        </button>
      </div>
    </div>
  );
}
