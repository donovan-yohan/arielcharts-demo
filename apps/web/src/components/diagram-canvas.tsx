'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
  Pencil,
  Shapes,
  ArrowRight,
  Trash2,
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize,
  MousePointer2,
  X,
} from 'lucide-react';
import type { NodeShape, ArrowType, ActivityEvent } from '../../packages/shared/src/types';
import { MutationQueue } from '@/lib/diagram-mutations';
import {
  SvgHitMap,
  buildSvgHitMap,
  findNodeAtPoint,
  getNodePortPositions,
} from '@/lib/svg-hit-map';

// Shape options for the shape picker
const SHAPE_OPTIONS: { shape: NodeShape; icon: string }[] = [
  { shape: 'rect', icon: '▭' },
  { shape: 'roundRect', icon: '▢' },
  { shape: 'stadium', icon: '▭' },
  { shape: 'subroutine', icon: '▭' },
  { shape: 'cylinder', icon: '◯' },
  { shape: 'circle', icon: '●' },
  { shape: 'asymmetric', icon: '◭' },
  { shape: 'rhombus', icon: '◆' },
  { shape: 'hexagon', icon: '⬡' },
  { shape: 'parallelogram', icon: '▱' },
];

// Arrow type options
const ARROW_OPTIONS: { type: ArrowType; label: string }[] = [
  { type: 'arrow', label: '→' },
  { type: 'open', label: '⇢' },
  { type: 'dot', label: '⇢•' },
  { type: 'none', label: '—' },
];

interface DiagramCanvasProps {
  svgContent: string;
  isValid: boolean;
  errorMessage?: string;
  isFlowchart: boolean;
  mutationQueue: MutationQueue | null;
  onActivity: (event: Omit<ActivityEvent, 'id' | 'timestamp'>) => void;
  participants: Array<{ name: string; color: string; type: 'human' | 'agent' }>;
}

type InteractionMode = 'select' | 'connect';

export function DiagramCanvas({
  svgContent,
  isValid,
  errorMessage,
  isFlowchart,
  mutationQueue,
  onActivity,
  participants,
}: DiagramCanvasProps) {
  // Canvas state
  const containerRef = useRef<HTMLDivElement>(null);
  const svgWrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Pan/zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastPanRef = useRef({ x: 0, y: 0 });

  // Selection state
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<InteractionMode>('select');

  // Connection mode state
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [connectArrowType, setConnectArrowType] = useState<ArrowType>('arrow');
  const [rubberBandEnd, setRubberBandEnd] = useState<{ x: number; y: number } | null>(null);

  // Inline editing state
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showShapePicker, setShowShapePicker] = useState(false);

  // Hit map for coordinate transforms
  const [hitMap, setHitMap] = useState<SvgHitMap | null>(null);

  // Build hit map when SVG content changes
  useEffect(() => {
    if (!svgRef.current || !isValid) {
      setHitMap(null);
      return;
    }

    // Use requestAnimationFrame to ensure SVG is fully rendered
    const rafId = requestAnimationFrame(() => {
      if (svgRef.current) {
        const newHitMap = buildSvgHitMap(svgRef.current);
        setHitMap(newHitMap);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [svgContent, isValid]);

  // Fit diagram to viewport on initial load
  useEffect(() => {
    if (hitMap && containerRef.current) {
      fitToViewport();
    }
  }, [hitMap]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete selected nodes
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodes.size > 0) {
        e.preventDefault();
        selectedNodes.forEach((nodeId) => {
          mutationQueue?.removeNode(nodeId);
        });
        onActivity({
          actor: { name: getUserName(), type: 'human' },
          action: 'edited',
          detail: `Deleted ${selectedNodes.size} node(s)`,
        });
        setSelectedNodes(new Set());
      }

      // Escape cancels current operation
      if (e.key === 'Escape') {
        setMode('select');
        setConnectSource(null);
        setRubberBandEnd(null);
        setSelectedNodes(new Set());
        setEditingNode(null);
        setShowShapePicker(false);
      }

      // Cmd+G to group
      if (e.key === 'g' && (e.metaKey || e.ctrlKey) && !e.shiftKey && selectedNodes.size > 1) {
        e.preventDefault();
        const label = prompt('Enter group label:', 'Group');
        if (label) {
          mutationQueue?.groupNodes(Array.from(selectedNodes), label);
          onActivity({
            actor: { name: getUserName(), type: 'human' },
            action: 'edited',
            detail: `Grouped ${selectedNodes.size} nodes`,
          });
          setSelectedNodes(new Set());
        }
      }

      // Cmd+Shift+G to ungroup
      if (e.key === 'G' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        // Find subgraph containing selected node
        // This is a simplified version - would need subgraph ID from hitMap
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodes, mutationQueue, onActivity]);

  // Get user name from localStorage or generate default
  const getUserName = useCallback(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('arielcharts-username') || 'You';
    }
    return 'You';
  }, []);

  // Zoom to cursor math
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!containerRef.current) return;

      e.preventDefault();

      const rect = containerRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      // Calculate canvas coordinates before zoom
      const canvasX = (clientX - pan.x) / zoom;
      const canvasY = (clientY - pan.y) / zoom;

      // Calculate new zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(4.0, zoom * delta));

      // Calculate new pan to keep cursor at same canvas position
      const newPanX = clientX - canvasX * newZoom;
      const newPanY = clientY - canvasY * newZoom;

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    },
    [zoom, pan]
  );

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.spaceKey)) {
        // Middle mouse or space+click = pan
        e.preventDefault();
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };
        lastPanRef.current = { ...pan };
      }
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan({
          x: lastPanRef.current.x + dx,
          y: lastPanRef.current.y + dy,
        });
      }

      // Update rubber band in connect mode
      if (mode === 'connect' && connectSource && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setRubberBandEnd({
          x: (e.clientX - rect.left - pan.x) / zoom,
          y: (e.clientY - rect.top - pan.y) / zoom,
        });
      }
    },
    [isPanning, mode, connectSource, pan, zoom]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Fit diagram to viewport
  const fitToViewport = useCallback(() => {
    if (!containerRef.current || !hitMap) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    const viewBox = hitMap.viewBox;
    const diagramWidth = viewBox.width;
    const diagramHeight = viewBox.height;

    if (diagramWidth === 0 || diagramHeight === 0) return;

    // Calculate zoom to fit with padding
    const padding = 40;
    const availableWidth = rect.width - padding * 2;
    const availableHeight = rect.height - padding * 2;

    const scaleX = availableWidth / diagramWidth;
    const scaleY = availableHeight / diagramHeight;
    const newZoom = Math.min(scaleX, scaleY, 1.5); // Cap at 150%

    // Center the diagram
    const newPanX = (rect.width - diagramWidth * newZoom) / 2 - viewBox.x * newZoom;
    const newPanY = (rect.height - diagramHeight * newZoom) / 2 - viewBox.y * newZoom;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [hitMap]);

  // Handle canvas click
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || !svgRef.current || !hitMap) return;

      const rect = containerRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      // Find clicked node
      const clickedNode = findNodeAtPoint(clientX, clientY, hitMap, svgRef.current);

      if (mode === 'connect') {
        if (clickedNode) {
          if (!connectSource) {
            // Start connection
            setConnectSource(clickedNode);
          } else if (clickedNode !== connectSource) {
            // Complete connection
            mutationQueue?.addEdge(connectSource, clickedNode, undefined, connectArrowType);
            onActivity({
              actor: { name: getUserName(), type: 'human' },
              action: 'edited',
              detail: `Connected ${connectSource} to ${clickedNode}`,
            });
            setConnectSource(null);
            setRubberBandEnd(null);
            setMode('select');
          }
        } else if (!connectSource) {
          // Cancel connect mode if clicking empty space
          setMode('select');
        }
      } else {
        // Select mode
        if (clickedNode) {
          if (e.shiftKey) {
            // Multi-select
            const newSelected = new Set(selectedNodes);
            if (newSelected.has(clickedNode)) {
              newSelected.delete(clickedNode);
            } else {
              newSelected.add(clickedNode);
            }
            setSelectedNodes(newSelected);
          } else {
            setSelectedNodes(new Set([clickedNode]));
          }
        } else {
          // Clicked empty space
          setSelectedNodes(new Set());
          setShowShapePicker(false);
        }
      }
    },
    [mode, connectSource, hitMap, selectedNodes, mutationQueue, onActivity, getUserName, connectArrowType]
  );

  // Handle double-click for inline editing
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || !svgRef.current || !hitMap || !isFlowchart) return;

      const rect = containerRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const clickedNode = findNodeAtPoint(clientX, clientY, hitMap, svgRef.current);
      if (clickedNode) {
        // Get current label from hit map or use nodeId as fallback
        setEditingNode(clickedNode);
        setEditValue(clickedNode);
        setShowShapePicker(false);
      }
    },
    [hitMap, isFlowchart]
  );

  // Commit inline edit
  const commitEdit = useCallback(() => {
    if (editingNode && editValue && mutationQueue) {
      mutationQueue.editNodeLabel(editingNode, editValue);
      onActivity({
        actor: { name: getUserName(), type: 'human' },
        action: 'edited',
        detail: `Edited label of ${editingNode}`,
      });
    }
    setEditingNode(null);
    setEditValue('');
  }, [editingNode, editValue, mutationQueue, onActivity, getUserName]);

  // Cancel inline edit
  const cancelEdit = useCallback(() => {
    setEditingNode(null);
    setEditValue('');
  }, []);

  // Handle shape change
  const handleShapeChange = useCallback(
    (shape: NodeShape) => {
      const selectedArray = Array.from(selectedNodes);
      if (selectedArray.length === 1) {
        const nodeId = selectedArray[0];
        mutationQueue?.changeNodeShape(nodeId, shape);
        onActivity({
          actor: { name: getUserName(), type: 'human' },
          action: 'edited',
          detail: `Changed shape of ${nodeId} to ${shape}`,
        });
      }
      setShowShapePicker(false);
    },
    [selectedNodes, mutationQueue, onActivity, getUserName]
  );

  // Handle add node
  const handleAddNode = useCallback(() => {
    if (!mutationQueue) return;

    const nodeId = `node${Date.now()}`;
    mutationQueue.addNode(nodeId, 'New Node', 'rect');
    onActivity({
      actor: { name: getUserName(), type: 'human' },
      action: 'edited',
      detail: `Added node ${nodeId}`,
    });
  }, [mutationQueue, onActivity, getUserName]);

  // Handle delete selected
  const handleDelete = useCallback(() => {
    selectedNodes.forEach((nodeId) => {
      mutationQueue?.removeNode(nodeId);
    });
    onActivity({
      actor: { name: getUserName(), type: 'human' },
      action: 'edited',
      detail: `Deleted ${selectedNodes.size} node(s)`,
    });
    setSelectedNodes(new Set());
    setShowShapePicker(false);
  }, [selectedNodes, mutationQueue, onActivity, getUserName]);

  // Calculate selection outline position
  const selectionOutline = useMemo(() => {
    if (selectedNodes.size !== 1 || !hitMap) return null;

    const nodeId = Array.from(selectedNodes)[0];
    const bounds = hitMap.nodes.get(nodeId);
    if (!bounds) return null;

    return {
      left: bounds.x * zoom + pan.x,
      top: bounds.y * zoom + pan.y,
      width: bounds.width * zoom,
      height: bounds.height * zoom,
    };
  }, [selectedNodes, hitMap, zoom, pan]);

  // Calculate toolbar position
  const toolbarPosition = useMemo(() => {
    if (!selectionOutline) return null;

    return {
      left: selectionOutline.left + selectionOutline.width / 2,
      top: selectionOutline.top - 48, // Above the node
    };
  }, [selectionOutline]);

  // Calculate shape picker position
  const shapePickerPosition = useMemo(() => {
    if (!toolbarPosition) return null;

    return {
      left: toolbarPosition.left - 40,
      top: toolbarPosition.top + 40,
    };
  }, [toolbarPosition]);

  // Calculate inline editor position
  const inlineEditorPosition = useMemo(() => {
    if (!editingNode || !hitMap) return null;

    const bounds = hitMap.nodes.get(editingNode);
    if (!bounds) return null;

    return {
      left: bounds.centerX * zoom + pan.x,
      top: bounds.centerY * zoom + pan.y,
    };
  }, [editingNode, hitMap, zoom, pan]);

  // Calculate connection port positions
  const connectionPorts = useMemo(() => {
    if (mode !== 'connect' || !connectSource || !hitMap) return null;

    return getNodePortPositions(connectSource, hitMap);
  }, [mode, connectSource, hitMap]);

  // Parse SVG content
  useEffect(() => {
    if (svgWrapperRef.current && svgContent) {
      svgWrapperRef.current.innerHTML = svgContent;
      const svg = svgWrapperRef.current.querySelector('svg');
      if (svg) {
        svgRef.current = svg;
        svg.classList.add('mermaid-svg');
      }
    }
  }, [svgContent]);

  // Close editors when zoom is too low
  useEffect(() => {
    if (zoom < 0.4) {
      setEditingNode(null);
      setShowShapePicker(false);
    }
  }, [zoom]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-deep"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleCanvasClick}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: isPanning ? 'grabbing' : mode === 'connect' ? 'crosshair' : 'default' }}
    >
      {/* Transform wrapper for SVG and overlays */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* SVG container */}
        <div
          ref={svgWrapperRef}
          className="absolute inset-0"
          dangerouslySetInnerHTML={{ __html: '' }}
        />

        {/* Connection ports in connect mode */}
        {mode === 'connect' && connectionPorts && (
          <>
            <div
              className="connection-port"
              style={{ left: connectionPorts.top.x - 6, top: connectionPorts.top.y - 6 }}
            />
            <div
              className="connection-port"
              style={{ left: connectionPorts.right.x - 6, top: connectionPorts.right.y - 6 }}
            />
            <div
              className="connection-port"
              style={{ left: connectionPorts.bottom.x - 6, top: connectionPorts.bottom.y - 6 }}
            />
            <div
              className="connection-port"
              style={{ left: connectionPorts.left.x - 6, top: connectionPorts.left.y - 6 }}
            />
          </>
        )}

        {/* Rubber band line */}
        {mode === 'connect' && connectSource && rubberBandEnd && connectionPorts && (
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: '100%', height: '100%' }}
          >
            <line
              x1={connectionPorts.right.x}
              y1={connectionPorts.right.y}
              x2={rubberBandEnd.x}
              y2={rubberBandEnd.y}
              stroke="var(--accent)"
              strokeWidth={2 / zoom}
              strokeDasharray={`${5 / zoom},${5 / zoom}`}
            />
          </svg>
        )}
      </div>

      {/* Selection outline (outside transform to avoid scaling the border) */}
      {selectionOutline && (
        <div
          className="selection-outline"
          style={{
            left: selectionOutline.left,
            top: selectionOutline.top,
            width: selectionOutline.width,
            height: selectionOutline.height,
          }}
        />
      )}

      {/* Contextual toolbar */}
      {toolbarPosition && selectedNodes.size === 1 && !editingNode && (
        <div
          className="contextual-toolbar"
          style={{
            left: toolbarPosition.left,
            top: toolbarPosition.top,
            transform: 'translateX(-50%)',
          }}
        >
          <button
            className="toolbar-button"
            onClick={(e) => {
              e.stopPropagation();
              const nodeId = Array.from(selectedNodes)[0];
              setEditingNode(nodeId);
              setEditValue(nodeId);
            }}
            title="Edit label"
          >
            <Pencil size={16} />
          </button>
          <button
            className="toolbar-button"
            onClick={(e) => {
              e.stopPropagation();
              setShowShapePicker(!showShapePicker);
            }}
            title="Change shape"
          >
            <Shapes size={16} />
          </button>
          <button
            className={`toolbar-button ${mode === 'connect' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setMode(mode === 'connect' ? 'select' : 'connect');
              setConnectSource(Array.from(selectedNodes)[0]);
            }}
            title="Connect"
          >
            <ArrowRight size={16} />
          </button>
          <button
            className="toolbar-button"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
          <button
            className="toolbar-button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddNode();
            }}
            title="Add node"
          >
            <Plus size={16} />
          </button>
        </div>
      )}

      {/* Shape picker */}
      {showShapePicker && shapePickerPosition && (
        <div
          className="shape-picker"
          style={{
            left: shapePickerPosition.left,
            top: shapePickerPosition.top,
            transform: 'translateX(-50%)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {SHAPE_OPTIONS.map(({ shape, icon }) => (
            <button
              key={shape}
              className="shape-option"
              onClick={() => handleShapeChange(shape)}
              title={shape}
            >
              <span className="flex items-center justify-center h-full text-secondary">
                {icon}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Inline text editor */}
      {inlineEditorPosition && editingNode && (
        <input
          type="text"
          className="inline-editor"
          style={{
            left: inlineEditorPosition.left,
            top: inlineEditorPosition.top,
            transform: 'translate(-50%, -50%)',
          }}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitEdit();
            } else if (e.key === 'Escape') {
              cancelEdit();
            }
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {/* Mode hint pill */}
      {mode === 'connect' && (
        <div className="mode-hint" style={{ top: 16, left: '50%', transform: 'translateX(-50%)' }}>
          Click target node to connect • Press Escape to cancel
        </div>
      )}

      {/* Zoom controls */}
      <div className="zoom-controls" style={{ bottom: 16, right: 16 }}>
        <button className="zoom-button" onClick={() => setZoom((z) => Math.max(0.1, z * 0.9))}>
          <ZoomOut size={16} />
        </button>
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
        <button className="zoom-button" onClick={() => setZoom((z) => Math.min(4.0, z * 1.1))}>
          <ZoomIn size={16} />
        </button>
        <button className="zoom-button" onClick={fitToViewport} title="Fit to viewport">
          <Maximize size={16} />
        </button>
      </div>

      {/* Error banner */}
      {!isValid && errorMessage && (
        <div className="error-banner">
          <X size={14} className="inline mr-2" />
          {errorMessage}
        </div>
      )}

      {/* Empty state */}
      {isValid && hitMap && hitMap.nodes.size === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="empty-state">
            <p>Your diagram is empty</p>
            <button className="empty-state-button" onClick={handleAddNode}>
              Add your first node
            </button>
          </div>
        </div>
      )}

      {/* Non-flowchart notice */}
      {isValid && !isFlowchart && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-raised border border-border rounded-lg text-secondary text-sm">
          Visual editing is only available for flowcharts. Use the text editor to modify this diagram.
        </div>
      )}
    </div>
  );
}
