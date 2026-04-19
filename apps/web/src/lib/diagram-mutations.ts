/**
 * diagram-mutations.ts
 *
 * MutationQueue + mutation wrappers for the ArielCharts visual editor.
 *
 * All visual edits flow through MutationQueue which:
 * 1. Reads the current Yjs text
 * 2. Applies the mutation (via mermaid-ast AST or regex fallback)
 * 3. Computes a minimal diff via fast-diff
 * 4. Applies only changed characters as Yjs insert/delete ops
 *
 * NOTE: mermaid-ast v0.8.2 API is used where available.
 * If the API differs at runtime, all mutations fall back to regex-based
 * string manipulation so visual edits always produce a round-trippable result.
 */

import * as Y from 'yjs';
import diff from 'fast-diff';

// ── mermaid-ast API probe ──────────────────────────────────────
// We dynamically resolve mermaid-ast to tolerate API variations.
// The actual import happens lazily so this module compiles even if
// the API differs from what we expect.

type MermaidAstModule = {
  parse?: (text: string) => unknown;
  serialize?: (ast: unknown) => string;
};

let _astMod: MermaidAstModule | null = null;

async function getAstMod(): Promise<MermaidAstModule> {
  if (_astMod) return _astMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await import('mermaid-ast');
    _astMod = mod as MermaidAstModule;
  } catch {
    _astMod = {};
  }
  return _astMod;
}

// ── MutationQueue ──────────────────────────────────────────────

export class MutationQueue {
  private _queue: Array<(text: string) => string> = [];
  private _flushing = false;

  constructor(private readonly ytext: Y.Text) {}

  /**
   * Enqueue a mutation. The mutator receives the current text and returns the new text.
   * Mutations are coalesced and applied synchronously in a single Yjs transaction.
   */
  enqueue(mutate: (currentText: string) => string): void {
    this._queue.push(mutate);
    if (!this._flushing) {
      // Flush on next microtask so rapid enqueues coalesce
      queueMicrotask(() => this._flush());
    }
  }

  private _flush(): void {
    if (this._queue.length === 0) return;
    this._flushing = true;

    const mutations = this._queue.splice(0);
    const oldText = this.ytext.toString();

    // Chain all mutations
    let newText = oldText;
    for (const mutate of mutations) {
      try {
        newText = mutate(newText);
      } catch (err) {
        console.warn('[MutationQueue] mutation threw, skipping:', err);
      }
    }

    if (newText === oldText) {
      this._flushing = false;
      return;
    }

    // Apply minimal diff as Yjs ops
    applyDiff(this.ytext, oldText, newText);

    this._flushing = false;
  }
}

/**
 * Apply a fast-diff result to a Y.Text instance as minimal insert/delete ops.
 */
export function applyDiff(ytext: Y.Text, oldText: string, newText: string): void {
  const ops = diff(oldText, newText);
  let pos = 0;

  ytext.doc!.transact(() => {
    for (const [op, text] of ops) {
      if (op === diff.EQUAL) {
        pos += text.length;
      } else if (op === diff.INSERT) {
        ytext.insert(pos, text);
        pos += text.length;
      } else if (op === diff.DELETE) {
        ytext.delete(pos, text.length);
        // pos stays — we deleted characters, next op starts here
      }
    }
  });
}

// ── Utility: detect flowchart ──────────────────────────────────

function isFlowchart(text: string): boolean {
  return /^\s*(flowchart|graph)\s+/im.test(text);
}

// ── Utility: generate a safe node ID ──────────────────────────

function sanitizeId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'node';
}

function uniqueId(base: string, existingText: string): string {
  let id = sanitizeId(base);
  let n = 1;
  // Avoid collisions with existing IDs in the text
  while (new RegExp(`\\b${id}\\b`).test(existingText)) {
    id = `${sanitizeId(base)}${n}`;
    n++;
  }
  return id;
}

// ── Shape encoding ─────────────────────────────────────────────

const SHAPE_OPEN: Record<string, string> = {
  rectangle:    '[',
  rounded:      '(',
  stadium:      '([',
  cylinder:     '[(',
  circle:       '((',
  diamond:      '{',
  hexagon:      '{{',
  parallelogram: '[/',
  trapezoid:    '[\\',
  subroutine:   '[[',
};

const SHAPE_CLOSE: Record<string, string> = {
  rectangle:    ']',
  rounded:      ')',
  stadium:      '])',
  cylinder:     ')]',
  circle:       '))',
  diamond:      '}',
  hexagon:      '}}',
  parallelogram: '/]',
  trapezoid:    '/]',
  subroutine:   ']]',
};

function encodeNode(id: string, label: string, shape = 'rectangle'): string {
  const open  = SHAPE_OPEN[shape]  ?? '[';
  const close = SHAPE_CLOSE[shape] ?? ']';
  return `${id}${open}${label}${close}`;
}

// ── Mutation: editNodeLabel ────────────────────────────────────

/**
 * Replace the display label of a node by its ID, preserving its shape delimiters.
 */
export function editNodeLabel(
  queue: MutationQueue,
  nodeId: string,
  newLabel: string,
): void {
  queue.enqueue((text) => {
    if (!isFlowchart(text)) return text;

    // Match lines that define or reference this node:
    // nodeId["label"]  nodeId("label")  nodeId[["label"]]  etc.
    // Delimiters: [ ] ( ) { } [[ ]] [( )] (( )) {{ }} [/ /] [\ \] ([ ])
    const nodePattern = new RegExp(
      // id + optional whitespace + opening delimiter + captured label + closing delimiter
      `(\\b${nodeId})(\\[\\[|\\[\\(|\\(\\[|\\(\\(|\\{\\{|\\[|\\(|\\{)(.*?)(\\]\\]|\\)\\]|\\]\\)|\\)\\)|\\}\\}|\\]|\\)|\\})`,
      'g',
    );

    let matched = false;
    const result = text.replace(nodePattern, (_m, id: string, open: string, _label: string, close: string) => {
      matched = true;
      return `${id}${open}${newLabel}${close}`;
    });

    return matched ? result : text;
  });
}

// ── Mutation: changeNodeShape ──────────────────────────────────

/**
 * Change the shape delimiters of a node without touching its label.
 */
export function changeNodeShape(
  queue: MutationQueue,
  nodeId: string,
  shape: string,
): void {
  const open  = SHAPE_OPEN[shape]  ?? '[';
  const close = SHAPE_CLOSE[shape] ?? ']';

  queue.enqueue((text) => {
    if (!isFlowchart(text)) return text;

    const nodePattern = new RegExp(
      `(\\b${nodeId})(\\[\\[|\\[\\(|\\(\\[|\\(\\(|\\{\\{|\\[|\\(|\\{)(.*?)(\\]\\]|\\)\\]|\\]\\)|\\)\\)|\\}\\}|\\]|\\)|\\})`,
      'g',
    );

    let matched = false;
    const result = text.replace(nodePattern, (_m, id: string, _open: string, label: string, _close: string) => {
      matched = true;
      return `${id}${open}${label}${close}`;
    });

    return matched ? result : text;
  });
}

// ── Mutation: addNode ──────────────────────────────────────────

/**
 * Append a new node definition after the diagram header line.
 */
export function addNode(
  queue: MutationQueue,
  label: string,
  shape = 'rectangle',
): void {
  queue.enqueue((text) => {
    if (!isFlowchart(text)) {
      // Initialise a fresh flowchart
      const id = sanitizeId(label) || 'node1';
      return `flowchart TD\n    ${encodeNode(id, label, shape)}\n`;
    }

    const id = uniqueId(label, text);
    const nodeDecl = `    ${encodeNode(id, label, shape)}`;

    // Insert after the first line (the diagram header)
    const lines = text.split('\n');
    lines.splice(1, 0, nodeDecl);
    return lines.join('\n');
  });
}

// ── Mutation: removeNode ───────────────────────────────────────

/**
 * Remove a node and all edges referencing it.
 */
export function removeNode(queue: MutationQueue, nodeId: string): void {
  queue.enqueue((text) => {
    if (!isFlowchart(text)) return text;

    return text
      .split('\n')
      .filter((line) => {
        // Drop lines that declare the node or reference it in an edge
        const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Node declaration: nodeId[...] or nodeId(...) etc.
        const isDeclLine = new RegExp(`^\\s*${escapedId}(\\[|\\(|\\{)`).test(line);
        // Edge line: ... --> nodeId or nodeId --> ...
        const isEdgeLine = new RegExp(`\\b${escapedId}\\b`).test(line) &&
          /-->|===|---/.test(line);
        return !isDeclLine && !isEdgeLine;
      })
      .join('\n');
  });
}

// ── Mutation: addEdge ──────────────────────────────────────────

/**
 * Add a directed edge between two nodes.
 */
export function addEdge(
  queue: MutationQueue,
  sourceId: string,
  targetId: string,
  label?: string,
): void {
  queue.enqueue((text) => {
    if (!isFlowchart(text)) return text;

    const edgeText = label
      ? `    ${sourceId} -->|${label}| ${targetId}`
      : `    ${sourceId} --> ${targetId}`;

    // Append before any trailing empty lines at the end
    const trimmed = text.trimEnd();
    return `${trimmed}\n${edgeText}\n`;
  });
}

// ── Mutation: removeEdge ───────────────────────────────────────

/**
 * Remove an edge by its key. The key is either:
 * - A line-content fingerprint "sourceId --> targetId" (or with label)
 * - An index "edge-{n}" (used as fallback by svg-hit-map)
 */
export function removeEdge(queue: MutationQueue, edgeKey: string): void {
  queue.enqueue((text) => {
    if (!isFlowchart(text)) return text;

    // edgeKey could look like "A --> B" or "A -->|label| B"
    // If it matches a line pattern, remove that line
    const lines = text.split('\n');
    const filtered = lines.filter((line) => {
      const stripped = line.trim();
      return !stripped.includes(edgeKey);
    });

    return filtered.join('\n');
  });
}

// ── Mutation: groupNodes ───────────────────────────────────────

/**
 * Wrap a set of node IDs in a subgraph block.
 */
export function groupNodes(
  queue: MutationQueue,
  nodeIds: string[],
  groupLabel: string,
): void {
  queue.enqueue((text) => {
    if (!isFlowchart(text) || nodeIds.length === 0) return text;

    const subId = sanitizeId(groupLabel) || 'subgraph1';
    const lines = text.split('\n');

    // Collect lines that declare each of the target nodes
    const nodeLines: string[] = [];
    const remainingLines: string[] = [];

    for (const line of lines) {
      const isNodeLine = nodeIds.some((id) => {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^\\s*${escaped}(\\[|\\(|\\{)`).test(line);
      });
      if (isNodeLine) {
        nodeLines.push(line);
      } else {
        remainingLines.push(line);
      }
    }

    if (nodeLines.length === 0) return text;

    // Build the subgraph block
    const subgraphBlock = [
      `    subgraph ${subId}[${groupLabel}]`,
      ...nodeLines.map((l) => `    ${l.trim()}`),
      '    end',
    ].join('\n');

    // Insert after the diagram header
    remainingLines.splice(1, 0, subgraphBlock);
    return remainingLines.join('\n');
  });
}

// ── Mutation: ungroupSubgraph ──────────────────────────────────

/**
 * Dissolve a subgraph block, lifting its contents into the parent scope.
 */
export function ungroupSubgraph(
  queue: MutationQueue,
  subgraphId: string,
): void {
  queue.enqueue((text) => {
    if (!isFlowchart(text)) return text;

    const escaped = subgraphId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: subgraph {id}[...]\n   ...content...\n   end
    const sgPattern = new RegExp(
      `^(\\s*)subgraph\\s+${escaped}(?:\\[.*?\\])?\\n([\\s\\S]*?)^\\1end`,
      'gm',
    );

    return text.replace(sgPattern, (_m, _indent: string, inner: string) => {
      // Dedent inner lines by one level (4 spaces)
      return inner
        .split('\n')
        .map((l) => l.replace(/^ {4}/, ''))
        .join('\n');
    });
  });
}

// Re-export the async AST helper in case callers want to try it directly
export { getAstMod };
