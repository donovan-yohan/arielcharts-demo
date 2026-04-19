export interface SvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgEdgeHit {
  key: string;
  bounds: SvgBounds;
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

function getBounds(element: SVGGraphicsElement): SvgBounds | null {
  const ctm = element.getCTM();
  if (!ctm) {
    return null;
  }

  const box = element.getBBox();
  const points = [
    new DOMPoint(box.x, box.y),
    new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x, box.y + box.height),
    new DOMPoint(box.x + box.width, box.y + box.height),
  ].map((point) => point.matrixTransform(ctm));

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

export function buildSvgHitMap(svg: SVGSVGElement | null): SvgHitMap | null {
  if (!svg) {
    return null;
  }

  const nodes = new Map<string, SvgBounds>();
  svg.querySelectorAll<SVGGElement>('g.node[id]').forEach((element) => {
    const match = element.id.match(/^flowchart-([^-]+)-/);
    if (!match) {
      return;
    }
    const bounds = getBounds(element);
    if (bounds) {
      nodes.set(match[1], bounds);
    }
  });

  const edges = new Map<string, SvgEdgeHit>();
  svg.querySelectorAll<SVGGElement>('g.edgePath').forEach((element, index) => {
    const path = element.querySelector<SVGGraphicsElement>('path');
    if (!path) {
      return;
    }
    const bounds = getBounds(path);
    if (bounds) {
      edges.set(`edge-${index}`, { key: `edge-${index}`, bounds });
    }
  });

  const subgraphs = new Map<string, SvgBounds>();
  svg.querySelectorAll<SVGGElement>('g.cluster').forEach((element, index) => {
    const bounds = getBounds(element);
    if (bounds) {
      subgraphs.set(element.id || `cluster-${index}`, bounds);
    }
  });

  const viewBox = svg.viewBox.baseVal;
  return {
    nodes,
    edges,
    subgraphs,
    viewBox: {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width || svg.clientWidth,
      height: viewBox.height || svg.clientHeight,
    },
  };
}
