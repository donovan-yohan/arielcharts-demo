import diff from 'fast-diff';
import * as Y from 'yjs';

export type NodeShape = 'rect' | 'round' | 'stadium' | 'subroutine' | 'diamond' | 'circle';

export interface ParsedNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ParsedDiagram {
  kind: 'flowchart' | 'other' | 'empty';
  direction?: string;
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

const shapeTokens: Record<NodeShape, { open: string; close: string }> = {
  rect: { open: '[', close: ']' },
  round: { open: '(', close: ')' },
  stadium: { open: '([', close: '])' },
  subroutine: { open: '[[', close: ']]' },
  diamond: { open: '{', close: '}' },
  circle: { open: '((', close: '))' },
};

const nodePattern = /([A-Za-z][A-Za-z0-9_]*)\s*(\(\(|\(\[|\[\[|\[|\(|\{)([^\n\]\)\}]+?)(\)\)|\]\)|\]\]|\]|\)|\})/g;
export function parseDiagram(source: string): ParsedDiagram {
  const trimmed = source.trim();
  if (!trimmed) {
    return { kind: 'empty', nodes: [], edges: [] };
  }

  const header = trimmed.split('\n')[0]?.trim() ?? '';
  if (!header.startsWith('flowchart')) {
    return { kind: 'other', nodes: [], edges: [] };
  }

  const nodes = new Map<string, ParsedNode>();
  for (const match of source.matchAll(nodePattern)) {
    const [, id, open, rawLabel, close] = match;
    nodes.set(id, {
      id,
      label: rawLabel.trim(),
      shape: tokenToShape(open, close),
    });
  }

  const edges: ParsedEdge[] = [];
  for (const line of source.split('\n')) {
    const arrowIndex = line.indexOf('-->');
    if (arrowIndex === -1) continue;
    const left = line.slice(0, arrowIndex).trim();
    const right = line.slice(arrowIndex + 3).trim();
    const from = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)/)?.[1];
    const targetPart = right.startsWith('|') ? right.slice(right.indexOf('|', 1) + 1).trim() : right;
    const to = targetPart.match(/([A-Za-z][A-Za-z0-9_]*)/g)?.[0];
    const labelMatch = right.match(/^\|([^|]+)\|/);
    if (from && to) {
      edges.push({ from, to, label: labelMatch?.[1]?.trim() });
    }
  }

  return {
    kind: 'flowchart',
    direction: header.split(/\s+/)[1] ?? 'TD',
    nodes: [...nodes.values()],
    edges,
  };
}

function tokenToShape(open: string, close: string): NodeShape {
  if (open === '{' && close === '}') return 'diamond';
  if (open === '((' && close === '))') return 'circle';
  if (open === '([' && close === '])') return 'stadium';
  if (open === '[[' && close === ']]') return 'subroutine';
  if (open === '(' && close === ')') return 'round';
  return 'rect';
}

function renderNode(node: ParsedNode) {
  const shape = shapeTokens[node.shape];
  return `${node.id}${shape.open}${node.label}${shape.close}`;
}

function serialize(parsed: ParsedDiagram) {
  if (parsed.kind !== 'flowchart') {
    return '';
  }

  const lines = [`flowchart ${parsed.direction ?? 'TD'}`];
  for (const node of parsed.nodes) {
    lines.push(`    ${renderNode(node)}`);
  }
  for (const edge of parsed.edges) {
    const label = edge.label ? `|${edge.label}|` : '';
    lines.push(`    ${edge.from} -->${label} ${edge.to}`);
  }
  return lines.join('\n');
}

function nextNodeId(parsed: ParsedDiagram) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (const letter of alphabet) {
    if (!parsed.nodes.find((node) => node.id === letter)) {
      return letter;
    }
  }
  return `node_${parsed.nodes.length + 1}`;
}

export class MutationQueue {
  private pending = Promise.resolve();

  constructor(private readonly text: Y.Text) {}

  enqueue(mutate: (currentText: string) => string) {
    this.pending = this.pending.then(async () => {
      const current = this.text.toString();
      const next = mutate(current);
      if (next === current) {
        return;
      }
      applyDiff(this.text, current, next);
    });

    return this.pending;
  }

  editNodeLabel(nodeId: string, label: string) {
    return this.enqueue((current) => {
      const parsed = parseDiagram(current);
      if (parsed.kind !== 'flowchart') return current;
      parsed.nodes = parsed.nodes.map((node) => (node.id === nodeId ? { ...node, label } : node));
      return serialize(parsed);
    });
  }

  changeNodeShape(nodeId: string, shape: NodeShape) {
    return this.enqueue((current) => {
      const parsed = parseDiagram(current);
      if (parsed.kind !== 'flowchart') return current;
      parsed.nodes = parsed.nodes.map((node) => (node.id === nodeId ? { ...node, shape } : node));
      return serialize(parsed);
    });
  }

  addNode(afterNodeId?: string) {
    return this.enqueue((current) => {
      const parsed = parseDiagram(current);
      if (parsed.kind === 'empty') {
        return 'flowchart TD\n    a[First node]';
      }
      if (parsed.kind !== 'flowchart') return current;
      const id = nextNodeId(parsed);
      parsed.nodes.push({ id, label: 'New step', shape: 'rect' });
      if (afterNodeId) {
        parsed.edges.push({ from: afterNodeId, to: id });
      }
      return serialize(parsed);
    });
  }

  removeNodes(nodeIds: string[]) {
    return this.enqueue((current) => {
      const parsed = parseDiagram(current);
      if (parsed.kind !== 'flowchart') return current;
      parsed.nodes = parsed.nodes.filter((node) => !nodeIds.includes(node.id));
      parsed.edges = parsed.edges.filter((edge) => !nodeIds.includes(edge.from) && !nodeIds.includes(edge.to));
      return serialize(parsed);
    });
  }

  addEdge(from: string, to: string) {
    return this.enqueue((current) => {
      const parsed = parseDiagram(current);
      if (parsed.kind !== 'flowchart') return current;
      if (!parsed.edges.find((edge) => edge.from === from && edge.to === to)) {
        parsed.edges.push({ from, to });
      }
      return serialize(parsed);
    });
  }
}

export function applyDiff(target: Y.Text, previous: string, next: string) {
  let index = 0;
  for (const [type, value] of diff(previous, next)) {
    if (type === 0) {
      index += value.length;
      continue;
    }
    if (type === -1) {
      target.delete(index, value.length);
      continue;
    }
    target.insert(index, value);
    index += value.length;
  }
}
