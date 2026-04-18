/**
 * SVG Hit Map - Coordinate transforms for interactive diagram editing
 * 
 * After mermaid renders SVG, walk the DOM to build a hit map of node bounding boxes.
 * Uses getCTM() to transform local getBBox() coordinates through the full SVG
 * transform chain to CSS pixel coordinates.
 */

export interface SvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface SvgEdgeHit {
  from: string;
  to: string;
  pathElement: SVGPathElement;
  bounds: SvgBounds;
  midPoint: { x: number; y: number };
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
 * Build a hit map from a rendered mermaid SVG element
 */
export function buildSvgHitMap(svgElement: SVGSVGElement): SvgHitMap {
  const nodes = new Map<string, SvgBounds>();
  const edges = new Map<string, SvgEdgeHit>();
  const subgraphs = new Map<string, SvgBounds>();

  // Parse viewBox
  const viewBoxAttr = svgElement.getAttribute('viewBox');
  let viewBox: SvgViewBox;
  if (viewBoxAttr) {
    const [x, y, width, height] = viewBoxAttr.split(' ').map(Number);
    viewBox = { x, y, width, height };
  } else {
    // Fallback to bounding client rect
    const rect = svgElement.getBoundingClientRect();
    viewBox = { x: 0, y: 0, width: rect.width, height: rect.height };
  }

  // Get SVG coordinate transformation matrix
  const ctm = svgElement.getCTM();
  if (!ctm) {
    console.warn('Could not get CTM from SVG element');
    return { nodes, edges, subgraphs, viewBox };
  }

  // Find all nodes - mermaid v11 uses class "node" with id pattern "flowchart-{nodeId}-{index}"
  const nodeElements = svgElement.querySelectorAll('.node');
  nodeElements.forEach((nodeEl) => {
    const id = extractNodeId(nodeEl.id);
    if (!id) return;

    const bounds = getElementBounds(nodeEl as SVGGraphicsElement, ctm);
    if (bounds) {
      nodes.set(id, bounds);
    }
  });

  // Find all edges - mermaid v11 uses class "edgePath"
  const edgeElements = svgElement.querySelectorAll('.edgePath');
  edgeElements.forEach((edgeEl, index) => {
    const pathEl = edgeEl.querySelector('path') as SVGPathElement | null;
    if (!pathEl) return;

    // Try to extract from/to from the path or parent element
    const edgeInfo = extractEdgeInfo(edgeEl, pathEl, index);
    if (!edgeInfo) return;

    const bounds = getElementBounds(pathEl, ctm);
    if (!bounds) return;

    // Calculate midpoint for edge label placement
    const pathLength = pathEl.getTotalLength();
    const midPoint = pathEl.getPointAtLength(pathLength / 2);
    const transformedMidPoint = transformPoint(midPoint.x, midPoint.y, ctm);

    const edgeKey = `${edgeInfo.from}-->${edgeInfo.to}`;
    edges.set(edgeKey, {
      from: edgeInfo.from,
      to: edgeInfo.to,
      pathElement: pathEl,
      bounds,
      midPoint: transformedMidPoint,
    });
  });

  // Find all subgraphs/clusters - mermaid v11 uses class "cluster"
  const clusterElements = svgElement.querySelectorAll('.cluster');
  clusterElements.forEach((clusterEl) => {
    const id = extractSubgraphId(clusterEl.id);
    if (!id) return;

    const bounds = getElementBounds(clusterEl as SVGGraphicsElement, ctm);
    if (bounds) {
      subgraphs.set(id, bounds);
    }
  });

  return { nodes, edges, subgraphs, viewBox };
}

/**
 * Extract node ID from mermaid SVG element ID
 * Format: "flowchart-{nodeId}-{index}" or "flowchart-{nodeId}-{index}-..."
 */
function extractNodeId(elementId: string): string | null {
  if (!elementId) return null;

  // Handle flowchart prefix
  if (elementId.startsWith('flowchart-')) {
    const parts = elementId.slice('flowchart-'.length).split('-');
    // The node ID is everything except the last numeric index part
    if (parts.length >= 2) {
      // Last part is typically the index, rest is the node ID
      const lastPart = parts[parts.length - 1];
      if (/^\d+$/.test(lastPart)) {
        return parts.slice(0, -1).join('-');
      }
    }
    return parts.join('-');
  }

  // Handle other diagram types or return as-is
  return elementId;
}

/**
 * Extract subgraph/cluster ID from element ID
 */
function extractSubgraphId(elementId: string): string | null {
  if (!elementId) return null;

  // Cluster IDs often follow similar patterns
  if (elementId.startsWith('cluster-')) {
    return elementId.slice('cluster-'.length);
  }

  return elementId;
}

/**
 * Extract edge from/to information
 */
function extractEdgeInfo(
  edgeEl: Element,
  pathEl: SVGPathElement,
  index: number
): { from: string; to: string } | null {
  // Try to get from data attributes
  const fromAttr = edgeEl.getAttribute('data-from') || pathEl.getAttribute('data-from');
  const toAttr = edgeEl.getAttribute('data-to') || pathEl.getAttribute('data-to');

  if (fromAttr && toAttr) {
    return { from: fromAttr, to: toAttr };
  }

  // Try to parse from ID
  // Format might be: "L-{from}-{to}-..." or similar
  const id = edgeEl.id || pathEl.id;
  if (id) {
    const match = id.match(/(?:^|[-_])([^-_]+)[-_]([^-_]+)/);
    if (match) {
      return { from: match[1], to: match[2] };
    }
  }

  // Fallback: use index-based IDs (will need to be resolved later)
  return { from: `unknown-${index}-from`, to: `unknown-${index}-to` };
}

/**
 * Get bounding box of an SVG element transformed to CSS pixel coordinates
 */
function getElementBounds(
  element: SVGGraphicsElement,
  svgCtm: DOMMatrix
): SvgBounds | null {
  try {
    // Get local bounding box
    const bbox = element.getBBox();

    // Get the element's transform matrix
    const elementCtm = element.getCTM();
    if (!elementCtm) return null;

    // Combine with SVG CTM to get final transform
    const combinedCtm = elementCtm.multiply(svgCtm);

    // Transform all four corners of the bbox
    const topLeft = transformPoint(bbox.x, bbox.y, combinedCtm);
    const topRight = transformPoint(bbox.x + bbox.width, bbox.y, combinedCtm);
    const bottomLeft = transformPoint(bbox.x, bbox.y + bbox.height, combinedCtm);
    const bottomRight = transformPoint(bbox.x + bbox.width, bbox.y + bbox.height, combinedCtm);

    // Calculate bounding box of transformed corners
    const xs = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x];
    const ys = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y];

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const width = maxX - minX;
    const height = maxY - minY;

    return {
      x: minX,
      y: minY,
      width,
      height,
      centerX: minX + width / 2,
      centerY: minY + height / 2,
    };
  } catch (error) {
    console.warn('Failed to get element bounds:', error);
    return null;
  }
}

/**
 * Transform a point using a DOMMatrix
 */
function transformPoint(x: number, y: number, ctm: DOMMatrix): { x: number; y: number } {
  return {
    x: x * ctm.a + y * ctm.c + ctm.e,
    y: x * ctm.b + y * ctm.d + ctm.f,
  };
}

/**
 * Convert client coordinates to SVG coordinates
 */
export function clientToSvgCoordinates(
  clientX: number,
  clientY: number,
  svgElement: SVGSVGElement
): { x: number; y: number } | null {
  const point = svgElement.createSVGPoint();
  point.x = clientX;
  point.y = clientY;

  const ctm = svgElement.getScreenCTM();
  if (!ctm) return null;

  const svgPoint = point.matrixTransform(ctm.inverse());
  return { x: svgPoint.x, y: svgPoint.y };
}

/**
 * Convert SVG coordinates to client coordinates
 */
export function svgToClientCoordinates(
  svgX: number,
  svgY: number,
  svgElement: SVGSVGElement
): { x: number; y: number } | null {
  const point = svgElement.createSVGPoint();
  point.x = svgX;
  point.y = svgY;

  const ctm = svgElement.getScreenCTM();
  if (!ctm) return null;

  const clientPoint = point.matrixTransform(ctm);
  return { x: clientPoint.x, y: clientPoint.y };
}

/**
 * Find node at a given client coordinate
 */
export function findNodeAtPoint(
  clientX: number,
  clientY: number,
  hitMap: SvgHitMap,
  svgElement: SVGSVGElement
): string | null {
  const svgCoords = clientToSvgCoordinates(clientX, clientY, svgElement);
  if (!svgCoords) return null;

  for (const [nodeId, bounds] of hitMap.nodes) {
    if (
      svgCoords.x >= bounds.x &&
      svgCoords.x <= bounds.x + bounds.width &&
      svgCoords.y >= bounds.y &&
      svgCoords.y <= bounds.y + bounds.height
    ) {
      return nodeId;
    }
  }

  return null;
}

/**
 * Find edge at a given client coordinate (with tolerance)
 */
export function findEdgeAtPoint(
  clientX: number,
  clientY: number,
  hitMap: SvgHitMap,
  svgElement: SVGSVGElement,
  tolerance: number = 10
): string | null {
  const svgCoords = clientToSvgCoordinates(clientX, clientY, svgElement);
  if (!svgCoords) return null;

  for (const [edgeKey, edgeHit] of hitMap.edges) {
    // Simple bounding box check first
    const bounds = edgeHit.bounds;
    const expandedBounds = {
      x: bounds.x - tolerance,
      y: bounds.y - tolerance,
      width: bounds.width + tolerance * 2,
      height: bounds.height + tolerance * 2,
    };

    if (
      svgCoords.x >= expandedBounds.x &&
      svgCoords.x <= expandedBounds.x + expandedBounds.width &&
      svgCoords.y >= expandedBounds.y &&
      svgCoords.y <= expandedBounds.y + expandedBounds.height
    ) {
      // More precise check: distance to path
      const distance = getDistanceToPath(svgCoords.x, svgCoords.y, edgeHit.pathElement);
      if (distance <= tolerance) {
        return edgeKey;
      }
    }
  }

  return null;
}

/**
 * Get approximate distance from point to SVG path
 */
function getDistanceToPath(x: number, y: number, pathEl: SVGPathElement): number {
  const pathLength = pathEl.getTotalLength();
  let minDistance = Infinity;

  // Sample points along the path
  const samples = Math.min(50, Math.ceil(pathLength / 5));
  for (let i = 0; i <= samples; i++) {
    const point = pathEl.getPointAtLength((i / samples) * pathLength);
    const dx = point.x - x;
    const dy = point.y - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    minDistance = Math.min(minDistance, distance);
  }

  return minDistance;
}

/**
 * Get connection port positions for a node
 */
export function getNodePortPositions(
  nodeId: string,
  hitMap: SvgHitMap
): { top: { x: number; y: number }; right: { x: number; y: number }; bottom: { x: number; y: number }; left: { x: number; y: number } } | null {
  const bounds = hitMap.nodes.get(nodeId);
  if (!bounds) return null;

  return {
    top: { x: bounds.centerX, y: bounds.y },
    right: { x: bounds.x + bounds.width, y: bounds.centerY },
    bottom: { x: bounds.centerX, y: bounds.y + bounds.height },
    left: { x: bounds.x, y: bounds.centerY },
  };
}

/**
 * Check if a point is inside the SVG bounds
 */
export function isPointInSvg(
  clientX: number,
  clientY: number,
  svgElement: SVGSVGElement
): boolean {
  const rect = svgElement.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}
