import * as Y from 'yjs';
import diff from 'fast-diff';

// fast-diff constants: EQUAL=0, DELETE=-1, INSERT=1
const EQUAL = 0;
const DELETE = -1;
const INSERT = 1;

export class MutationQueue {
  private queue: Promise<void> = Promise.resolve();

  constructor(private yText: Y.Text) {}

  enqueue(mutate: (currentText: string) => string): void {
    this.queue = this.queue.then(() => {
      const currentText = this.yText.toString();
      const newText = mutate(currentText);
      if (newText === currentText) return;
      const diffs = diff(currentText, newText);
      this.yText.doc!.transact(() => {
        let pos = 0;
        for (const [op, text] of diffs) {
          if (op === EQUAL) {
            pos += text.length;
          } else if (op === DELETE) {
            this.yText.delete(pos, text.length);
          } else if (op === INSERT) {
            this.yText.insert(pos, text);
            pos += text.length;
          }
        }
      });
    });
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function editNodeLabel(text: string, nodeId: string, newLabel: string): string {
  const re = new RegExp(`(\\b${escapeRegex(nodeId)}\\s*)([\\[\\{\\(>\\[])((?:[^\\]\\}\\)>]|\\[(?:[^\\]]*)\\])*)([\\]\\}\\)>\\]])`, 'g');
  const replaced = text.replace(re, (_m, id, open, _old, close) => `${id}${open}${newLabel}${close}`);
  return replaced !== text ? replaced : text;
}

export function addNode(text: string, nodeId: string, label: string, shape: string = '[]'): string {
  const open = shape[0] ?? '[';
  const close = shape[shape.length - 1] ?? ']';
  const lines = text.trimEnd().split('\n');
  lines.push(`    ${nodeId}${open}${label}${close}`);
  return lines.join('\n') + '\n';
}

export function removeNode(text: string, nodeId: string): string {
  return text
    .split('\n')
    .filter(line => !new RegExp(`\\b${escapeRegex(nodeId)}\\b`).test(line))
    .join('\n');
}

export function addEdge(text: string, fromId: string, toId: string, label?: string, arrowType: string = '-->'): string {
  const lines = text.trimEnd().split('\n');
  const edgeLine = label
    ? `    ${fromId} ${arrowType}|${label}| ${toId}`
    : `    ${fromId} ${arrowType} ${toId}`;
  lines.push(edgeLine);
  return lines.join('\n') + '\n';
}

export function removeEdge(text: string, fromId: string, toId: string): string {
  return text
    .split('\n')
    .filter(line => !(new RegExp(`\\b${escapeRegex(fromId)}\\b`).test(line) && new RegExp(`\\b${escapeRegex(toId)}\\b`).test(line)))
    .join('\n');
}

export function groupNodes(text: string, nodeIds: string[], label: string, subgraphId: string): string {
  const lines = text.split('\n');
  const nodeLines: string[] = [];
  const otherLines: string[] = [];
  for (const line of lines) {
    if (nodeIds.some(id => new RegExp(`\\b${escapeRegex(id)}\\b`).test(line))) {
      nodeLines.push(line);
    } else {
      otherLines.push(line);
    }
  }
  return [...otherLines, `    subgraph ${subgraphId}["${label}"]`, ...nodeLines, '    end'].join('\n');
}
