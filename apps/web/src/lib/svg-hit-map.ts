/**
 * svg-hit-map.ts
 *
 * Builds a map of interactive regions from a rendered Mermaid SVG.
 * Uses getCTM() + getBBox() to translate local SVG coordinates to
 * CSS pixel coordinates, accounting for the full transform chain.
 */

export interface SvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgEdgeHit {
  bounds: SvgBounds;
  pathEl: SVGPathElement;
}

export interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgHitMap {
  nodes: Map<string, SvgBounds>;
  edges: Map<string, SvgEdgeHit>;
  subgraphs: Map<string, SvgBounds>;
  viewBox: SvgViewBox;
}

/**
 * Transform a getBBox() result through the element's CTM (Current Transform Matrix)
 * to get the bounding box in the coordinate space of the SVG viewport.
 */
function ctmBounds(el: SVGGraphicsElement, svgEl: SVGSVGElement): SvgBounds | null {
  try {
    const bbox = el.getBBox();
    const ctm = el.getCTM();
    if (!ctm) return null;

    // Transform all four corners through CTM and find the axis-aligned bounding box
    const corners = [
      svgEl.createSVGPoint(),
      svgEl.createSVGPoint(),
      svgEl.createSVGPoint(),
      svgEl.createSVGPoint(),
    ];
    corners[0]!.x = bbox.x;               corners[0]!.y = bbox.y;
    corners[1]!.x = bbox.x + bbox.width;  corners[1]!.y = bbox.y;
    corners[2]!.x = bbox.x + bbox.width;  corners[2]!.y = bbox.y + bbox.height;
    corners[3]!.x = bbox.x;               corners[3]!.y = bbox.y + bbox.height;

    const transformed = corners.map((p) => p!.matrixTransform(ctm));

    const xs = transformed.map((p) => p.x);
    const ys = transformed.map((p) => p.y);

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a nodeId from a Mermaid v11 node element id.
 * Format: "flowchart-{nodeId}-{index}"
 */
function extractNodeId(rawId: string): string | null {
  // flowchart-{nodeId}-{index}
  const match = /^flowchart-(.+)-\d+$/.exec(rawId);
  if (match) return match[1] ?? null;
  return null;
}

/**
 * Build a hit map from a rendered Mermaid SVG element.
 * Must be called after the SVG is in the DOM (requestAnimationFrame after render).
 */
export function buildHitMap(svgEl: SVGSVGElement): SvgHitMap {
  const hitMap: SvgHitMap = {
    nodes: new Map(),
    edges: new Map(),
    subgraphs: new Map(),
    viewBox: { x: 0, y: 0, width: 0, height: 0 },
  };

  // Parse viewBox
  const vb = svgEl.viewBox?.baseVal;
  if (vb) {
    hitMap.viewBox = { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
  }

  // ── Nodes ─────────────────────────────────────────────────
  const nodeEls = svgEl.querySelectorAll<SVGGElement>('g.node');
  for (const nodeEl of nodeEls) {
    const rawId = nodeEl.id;
    if (!rawId) continue;

    const nodeId = extractNodeId(rawId);
    if (!nodeId) continue;

    // Prefer the inner shape element for tighter bounds
    const inner =
      nodeEl.querySelector<SVGGraphicsElement>('rect, circle, ellipse, polygon, path') ??
      nodeEl;

    const bounds = ctmBounds(inner as SVGGraphicsElement, svgEl);
    if (bounds) {
      hitMap.nodes.set(nodeId, bounds);
    }
  }

  // ── Edges ──────────────────────────────────────────────────
  const edgeEls = svgEl.querySelectorAll<SVGGElement>('g.edgePath');
  let edgeIndex = 0;
  for (const edgeEl of edgeEls) {
    const pathEl = edgeEl.querySelector<SVGPathElement>('path');
    if (!pathEl) continue;

    const bounds = ctmBounds(pathEl, svgEl);
    if (!bounds) continue;

    // Try to get the edge key from data attributes or fall back to index
    const edgeKey =
      edgeEl.getAttribute('data-id') ??
      edgeEl.id ??
      `edge-${edgeIndex}`;

    hitMap.edges.set(edgeKey, { bounds, pathEl });
    edgeIndex++;
  }

  // ── Subgraphs ──────────────────────────────────────────────
  const clusterEls = svgEl.querySelectorAll<SVGGElement>('g.cluster');
  for (const clusterEl of clusterEls) {
    const rawId = clusterEl.id ?? '';
    // Cluster IDs often follow "subGraph0", "subGraph1", or custom IDs
    const subgraphId = rawId || `cluster-${hitMap.subgraphs.size}`;

    const rect =
      clusterEl.querySelector<SVGGraphicsElement>('rect') ?? clusterEl;
    const bounds = ctmBounds(rect as SVGGraphicsElement, svgEl);
    if (bounds) {
      hitMap.subgraphs.set(subgraphId, bounds);
    }
  }

  return hitMap;
}

/**
 * Checks whether a Mermaid SVG appears to be a flowchart.
 * Non-flowchart diagrams should be read-only.
 */
export function isFlowchart(svgEl: SVGSVGElement): boolean {
  return svgEl.querySelectorAll('g.node').length > 0;
}
