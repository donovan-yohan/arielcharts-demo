import diff from 'fast-diff';
import * as Y from 'yjs';

export type NodeShape = 'rect' | 'round' | 'stadium' | 'subroutine' | 'diamond' | 'circle';
export type EdgeArrowType = '-->' | '-.->' | '==>';

export interface ParsedNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
  arrowType?: EdgeArrowType;
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

const supportedArrowTypes: EdgeArrowType[] = ['-->', '-.->', '==>'];
const identifierPattern = /[A-Za-z][A-Za-z0-9_]*/;
const nodePattern = /(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*)\s*(\(\(|\(\[|\[\[|\[|\(|\{)([^\n\]\)\}]+?)(\)\)|\]\)|\]\]|\]|\)|\})/g;

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
  for (const line of source.split('\n')) {
    if (isCommentLine(line)) continue;
    for (const match of line.matchAll(nodePattern)) {
      const [, prefix, id, open, rawLabel, close] = match;
      if (prefix.includes('%')) continue;
      nodes.set(id, {
        id,
        label: rawLabel.trim(),
        shape: tokenToShape(open, close),
      });
    }
  }

  const edges: ParsedEdge[] = [];
  for (const line of source.split('\n')) {
    if (isCommentLine(line)) continue;
    const edgeMatch = parseEdgeLine(line);
    if (edgeMatch) {
      edges.push(edgeMatch);
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

function isCommentLine(line: string) {
  return line.trimStart().startsWith('%%');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceNodeDefinitions(source: string, nodeId: string, transform: (node: ParsedNode) => ParsedNode): string {
  const matcher = new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(nodeId)})\\s*(\\(\\(|\\(\\[|\\[\\[|\\[|\\(|\\{)([^\\n\\]\\)\\}]+?)(\\)\\)|\\]\\)|\\]\\]|\\]|\\)|\\})`, 'g');

  return source
    .split('\n')
    .map((line) => {
      if (isCommentLine(line)) {
        return line;
      }

      return line.replace(matcher, (_match, prefix: string, id: string, open: string, rawLabel: string, close: string) => {
        const next = transform({ id, label: rawLabel.trim(), shape: tokenToShape(open, close) });
        const shape = shapeTokens[next.shape];
        return `${prefix}${id}${shape.open}${next.label}${shape.close}`;
      });
    })
    .join('\n');
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

function inferIndentation(lines: string[]) {
  for (const line of lines) {
    if (!line.trim() || isCommentLine(line)) continue;
    const indent = line.match(/^\s*/)?.[0] ?? '';
    if (line.trim().startsWith('flowchart')) continue;
    return indent || '    ';
  }
  return '    ';
}

function findInsertionIndex(lines: string[], anchorPattern?: RegExp) {
  if (anchorPattern) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (anchorPattern.test(lines[index])) {
        return index + 1;
      }
    }
  }

  let lastContentIndex = lines.length;
  while (lastContentIndex > 0 && !lines[lastContentIndex - 1].trim()) {
    lastContentIndex -= 1;
  }
  return lastContentIndex;
}

function insertLines(source: string, newLines: string[], anchorPattern?: RegExp) {
  const lines = source.split('\n');
  const index = findInsertionIndex(lines, anchorPattern);
  lines.splice(index, 0, ...newLines);
  return lines.join('\n');
}

function parseEdgeLine(line: string): ParsedEdge | null {
  const arrowType = supportedArrowTypes.find((candidate) => line.includes(candidate));
  if (!arrowType) {
    return null;
  }

  const arrowIndex = line.indexOf(arrowType);
  const from = line.slice(0, arrowIndex).match(identifierPattern)?.[0];
  if (!from) {
    return null;
  }

  const right = line.slice(arrowIndex + arrowType.length).trim();
  const labelMatch = right.match(/^\|([^|]+)\|/);
  const targetPart = labelMatch ? right.slice(labelMatch[0].length).trim() : right;
  const to = targetPart.match(identifierPattern)?.[0];
  if (!to) {
    return null;
  }

  return { from, to, label: labelMatch?.[1]?.trim(), arrowType };
}

function edgeExists(source: string, from: string, to: string, arrowType?: EdgeArrowType, label?: string) {
  const parsed = parseDiagram(source);
  return parsed.edges.some(
    (edge) =>
      edge.from === from &&
      edge.to === to &&
      (arrowType ? edge.arrowType === arrowType : true) &&
      (label !== undefined ? (edge.label ?? '') === label : true),
  );
}

function removeEdgeLine(source: string, predicate: (edge: ParsedEdge) => boolean) {
  return source
    .split('\n')
    .filter((line) => {
      if (isCommentLine(line)) return true;
      const edge = parseEdgeLine(line);
      if (!edge) return true;
      return !predicate(edge);
    })
    .join('\n');
}

function removeNodeRelatedLines(source: string, nodeIds: string[]) {
  const nodeIdSet = new Set(nodeIds);
  return source
    .split('\n')
    .filter((line) => {
      if (isCommentLine(line)) return true;
      const trimmed = line.trim();
      if (!trimmed) return true;

      const edge = parseEdgeLine(line);
      if (edge && (nodeIdSet.has(edge.from) || nodeIdSet.has(edge.to))) {
        return false;
      }

      const nodeId = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(\(\(|\(\[|\[\[|\[|\(|\{)/)?.[1];
      if (nodeId && nodeIdSet.has(nodeId)) {
        return false;
      }

      return true;
    })
    .join('\n');
}

function normalizeFlowchartSource(source: string) {
  const parsed = parseDiagram(source);
  if (parsed.kind === 'empty') {
    return 'flowchart TD';
  }
  return parsed.kind === 'flowchart' ? source : null;
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
    return this.enqueue((current) => replaceNodeDefinitions(current, nodeId, (node) => ({ ...node, label })));
  }

  changeNodeShape(nodeId: string, shape: NodeShape) {
    return this.enqueue((current) => replaceNodeDefinitions(current, nodeId, (node) => ({ ...node, shape })));
  }

  addNode(afterNodeId?: string) {
    return this.enqueue((current) => {
      const normalized = normalizeFlowchartSource(current);
      if (normalized === null) return current;
      if (normalized === 'flowchart TD') {
        return `${normalized}\n    a[First node]`;
      }

      const parsed = parseDiagram(normalized);
      if (parsed.kind !== 'flowchart') return current;
      const id = nextNodeId(parsed);
      const lines = normalized.split('\n');
      const indent = inferIndentation(lines);
      const additions = [`${indent}${id}[New step]`];
      if (afterNodeId) {
        additions.push(`${indent}${afterNodeId} --> ${id}`);
      }
      return insertLines(normalized, additions, afterNodeId ? new RegExp(`\\b${escapeRegExp(afterNodeId)}\\b`) : /^flowchart\b/);
    });
  }

  removeNodes(nodeIds: string[]) {
    return this.enqueue((current) => removeNodeRelatedLines(current, nodeIds));
  }

  addEdge(from: string, to: string, label?: string, arrowType: EdgeArrowType = '-->') {
    return this.enqueue((current) => {
      const normalized = normalizeFlowchartSource(current);
      if (normalized === null) return current;
      if (edgeExists(normalized, from, to, arrowType, label)) {
        return normalized;
      }
      const indent = inferIndentation(normalized.split('\n'));
      const edgeLabel = label?.trim() ? `|${label.trim()}| ` : '';
      return insertLines(normalized, [`${indent}${from} ${arrowType} ${edgeLabel}${to}`], new RegExp(`\\b${escapeRegExp(from)}\\b|\\b${escapeRegExp(to)}\\b`));
    });
  }

  removeEdge(from: string, to: string) {
    return this.enqueue((current) => removeEdgeLine(current, (edge) => edge.from === from && edge.to === to));
  }

  groupNodes(nodeIds: string[], label: string) {
    return this.enqueue((current) => {
      const normalized = normalizeFlowchartSource(current);
      if (normalized === null || nodeIds.length === 0) return current;
      const lines = normalized.split('\n');
      const indexes = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => {
          const nodeId = line.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*(\(\(|\(\[|\[\[|\[|\(|\{)/)?.[1];
          return nodeId ? nodeIds.includes(nodeId) : false;
        })
        .map(({ index }) => index);

      if (indexes.length === 0) return current;
      const start = Math.min(...indexes);
      const end = Math.max(...indexes);
      const indent = lines[start].match(/^\s*/)?.[0] ?? '    ';
      const innerIndent = `${indent}  `;
      const subgraphId = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'group';
      const block = [
        `${indent}subgraph ${subgraphId}[${label}]`,
        ...lines.slice(start, end + 1).map((line) => `${innerIndent}${line.trimStart()}`),
        `${indent}end`,
      ];
      lines.splice(start, end - start + 1, ...block);
      return lines.join('\n');
    });
  }

  ungroupSubgraph(subgraphId: string) {
    return this.enqueue((current) => {
      const normalized = normalizeFlowchartSource(current);
      if (normalized === null) return current;
      const lines = normalized.split('\n');
      const start = lines.findIndex((line) => new RegExp(`^\\s*subgraph\\s+${escapeRegExp(subgraphId)}\b`).test(line));
      if (start === -1) return current;

      const result: string[] = [];
      let depth = 0;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (index === start) {
          depth = 1;
          continue;
        }
        if (depth > 0) {
          if (/^\s*subgraph\b/.test(line)) {
            depth += 1;
            result.push(line.replace(/^\s{2}/, ''));
            continue;
          }
          if (/^\s*end\s*$/.test(line)) {
            depth -= 1;
            if (depth === 0) {
              continue;
            }
          }
          result.push(line.replace(/^\s{2}/, ''));
          continue;
        }
        result.push(line);
      }
      return result.join('\n');
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
