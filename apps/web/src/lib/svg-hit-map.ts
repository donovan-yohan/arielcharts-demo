export interface SvgBounds {
  x: number; y: number; width: number; height: number;
}

export interface SvgEdgeHit {
  bounds: SvgBounds;
  path: SVGPathElement;
}

export interface SvgViewBox {
  x: number; y: number; width: number; height: number;
}

export interface SvgHitMap {
  nodes: Map<string, SvgBounds>;
  edges: Map<string, SvgEdgeHit>;
  subgraphs: Map<string, SvgBounds>;
  viewBox: SvgViewBox;
}

function elementToCSS(el: SVGGraphicsElement, svgEl: SVGSVGElement): SvgBounds {
  try {
    const bbox = el.getBBox();
    const ctm = el.getCTM();
    if (!ctm) return { x: 0, y: 0, width: 0, height: 0 };
    const pt0 = svgEl.createSVGPoint();
    const pt1 = svgEl.createSVGPoint();
    const pt2 = svgEl.createSVGPoint();
    const pt3 = svgEl.createSVGPoint();
    pt0.x = bbox.x;              pt0.y = bbox.y;
    pt1.x = bbox.x + bbox.width; pt1.y = bbox.y;
    pt2.x = bbox.x;              pt2.y = bbox.y + bbox.height;
    pt3.x = bbox.x + bbox.width; pt3.y = bbox.y + bbox.height;
    const pts = [pt0, pt1, pt2, pt3].map(p => p.matrixTransform(ctm));
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  } catch {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function buildHitMap(svgEl: SVGSVGElement): SvgHitMap {
  const nodes = new Map<string, SvgBounds>();
  const edges = new Map<string, SvgEdgeHit>();
  const subgraphs = new Map<string, SvgBounds>();

  const vb = svgEl.viewBox.baseVal;
  const viewBox: SvgViewBox = { x: vb.x, y: vb.y, width: vb.width, height: vb.height };

  svgEl.querySelectorAll('g.node[id]').forEach(el => {
    const match = el.id.match(/^flowchart-(.+?)-\d+$/);
    if (!match) return;
    nodes.set(match[1], elementToCSS(el as SVGGraphicsElement, svgEl));
  });

  svgEl.querySelectorAll('g.edgePath').forEach((el, i) => {
    const path = el.querySelector('path');
    if (!path) return;
    edges.set(`edge-${i}`, { bounds: elementToCSS(el as SVGGraphicsElement, svgEl), path: path as SVGPathElement });
  });

  svgEl.querySelectorAll('g.cluster[id]').forEach(el => {
    subgraphs.set(el.id, elementToCSS(el as SVGGraphicsElement, svgEl));
  });

  return { nodes, edges, subgraphs, viewBox };
}
