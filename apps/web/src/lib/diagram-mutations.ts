/**
 * Diagram Mutations - MutationQueue for visual edits
 * 
 * All visual edits flow through a MutationQueue that serializes operations
 * and applies minimal diffs to Yjs using fast-diff.
 */

import * as Y from 'yjs';
import fastDiff from 'fast-diff';
import type { NodeShape, ArrowType } from '../../packages/shared/src/types';

// Mermaid AST types (from mermaid-ast package)
interface MermaidNode {
  id: string;
  label?: string;
  shape?: string;
  classes?: string[];
}

interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
  arrowType?: string;
}

interface MermaidSubgraph {
  id: string;
  label?: string;
  nodes: string[];
}

interface MermaidFlowchart {
  nodes: MermaidNode[];
  edges: MermaidEdge[];
  subgraphs: MermaidSubgraph[];
}

// Mutation operation types
export interface EditNodeLabelMutation {
  type: 'editNodeLabel';
  nodeId: string;
  newLabel: string;
}

export interface ChangeNodeShapeMutation {
  type: 'changeNodeShape';
  nodeId: string;
  newShape: NodeShape;
}

export interface AddNodeMutation {
  type: 'addNode';
  nodeId: string;
  label: string;
  shape: NodeShape;
  position?: { x: number; y: number };
}

export interface RemoveNodeMutation {
  type: 'removeNode';
  nodeId: string;
}

export interface AddEdgeMutation {
  type: 'addEdge';
  from: string;
  to: string;
  label?: string;
  arrowType?: ArrowType;
}

export interface RemoveEdgeMutation {
  type: 'removeEdge';
  from: string;
  to: string;
}

export interface GroupNodesMutation {
  type: 'groupNodes';
  nodeIds: string[];
  label?: string;
}

export interface UngroupSubgraphMutation {
  type: 'ungroupSubgraph';
  subgraphId: string;
}

export type Mutation =
  | EditNodeLabelMutation
  | ChangeNodeShapeMutation
  | AddNodeMutation
  | RemoveNodeMutation
  | AddEdgeMutation
  | RemoveEdgeMutation
  | GroupNodesMutation
  | UngroupSubgraphMutation;

/**
 * MutationQueue - Serializes visual edits and applies minimal diffs to Yjs
 */
export class MutationQueue {
  private yText: Y.Text;
  private queue: Mutation[] = [];
  private processing = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 50;

  constructor(yText: Y.Text) {
    this.yText = yText;
  }

  /**
   * Enqueue a mutation for processing
   */
  enqueue(mutation: Mutation): void {
    this.queue.push(mutation);
    this.scheduleProcess();
  }

  /**
   * Schedule processing with debounce
   */
  private scheduleProcess(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.process(), this.DEBOUNCE_MS);
  }

  /**
   * Process all queued mutations
   */
  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const mutations = [...this.queue];
    this.queue = [];

    try {
      // Get current text
      const currentText = this.yText.toString();

      // Apply mutations to generate new text
      const newText = await this.applyMutations(currentText, mutations);

      // Calculate minimal diff and apply to Yjs
      if (currentText !== newText) {
        this.applyDiff(currentText, newText);
      }
    } catch (error) {
      console.error('Mutation processing failed:', error);
    } finally {
      this.processing = false;
      this.debounceTimer = null;

      // Process any mutations that arrived during processing
      if (this.queue.length > 0) {
        this.scheduleProcess();
      }
    }
  }

  /**
   * Apply mutations to mermaid text
   */
  private async applyMutations(text: string, mutations: Mutation[]): Promise<string> {
    // Lazy load mermaid-ast to avoid SSR issues
    const { parse, render } = await import('mermaid-ast');

    let result = text;

    for (const mutation of mutations) {
      try {
        // Parse current text to AST
        const ast = parse(result) as MermaidFlowchart;

        // Apply mutation to AST
        const mutatedAst = this.mutateAst(ast, mutation);

        // Serialize back to text
        result = render(mutatedAst);
      } catch (error) {
        console.warn('Failed to apply mutation:', mutation, error);
        // Continue with other mutations
      }
    }

    return result;
  }

  /**
   * Mutate the AST based on mutation type
   */
  private mutateAst(ast: MermaidFlowchart, mutation: Mutation): MermaidFlowchart {
    const newAst = { ...ast, nodes: [...ast.nodes], edges: [...ast.edges], subgraphs: [...ast.subgraphs] };

    switch (mutation.type) {
      case 'editNodeLabel': {
        const node = newAst.nodes.find(n => n.id === mutation.nodeId);
        if (node) {
          node.label = mutation.newLabel;
        }
        break;
      }

      case 'changeNodeShape': {
        const node = newAst.nodes.find(n => n.id === mutation.nodeId);
        if (node) {
          node.shape = mutation.newShape;
        }
        break;
      }

      case 'addNode': {
        const existingIndex = newAst.nodes.findIndex(n => n.id === mutation.nodeId);
        const newNode: MermaidNode = {
          id: mutation.nodeId,
          label: mutation.label,
          shape: mutation.newShape,
        };
        if (existingIndex >= 0) {
          newAst.nodes[existingIndex] = newNode;
        } else {
          newAst.nodes.push(newNode);
        }
        break;
      }

      case 'removeNode': {
        newAst.nodes = newAst.nodes.filter(n => n.id !== mutation.nodeId);
        newAst.edges = newAst.edges.filter(e => e.from !== mutation.nodeId && e.to !== mutation.nodeId);
        // Remove from subgraphs
        newAst.subgraphs = newAst.subgraphs.map(sg => ({
          ...sg,
          nodes: sg.nodes.filter(id => id !== mutation.nodeId),
        })).filter(sg => sg.nodes.length > 0);
        break;
      }

      case 'addEdge': {
        const existingEdge = newAst.edges.find(
          e => e.from === mutation.from && e.to === mutation.to
        );
        const newEdge: MermaidEdge = {
          from: mutation.from,
          to: mutation.to,
          label: mutation.label,
          arrowType: mutation.arrowType,
        };
        if (existingEdge) {
          Object.assign(existingEdge, newEdge);
        } else {
          newAst.edges.push(newEdge);
        }
        break;
      }

      case 'removeEdge': {
        newAst.edges = newAst.edges.filter(
          e => !(e.from === mutation.from && e.to === mutation.to)
        );
        break;
      }

      case 'groupNodes': {
        const subgraphId = `subgraph${newAst.subgraphs.length + 1}`;
        newAst.subgraphs.push({
          id: subgraphId,
          label: mutation.label || 'Group',
          nodes: mutation.nodeIds,
        });
        break;
      }

      case 'ungroupSubgraph': {
        newAst.subgraphs = newAst.subgraphs.filter(sg => sg.id !== mutation.subgraphId);
        break;
      }
    }

    return newAst;
  }

  /**
   * Apply minimal diff to Yjs text using fast-diff
   */
  private applyDiff(oldText: string, newText: string): void {
    const diffs = fastDiff(oldText, newText);

    let pos = 0;
    for (const [type, text] of diffs) {
      if (type === fastDiff.INSERT) {
        this.yText.insert(pos, text);
        pos += text.length;
      } else if (type === fastDiff.DELETE) {
        this.yText.delete(pos, text.length);
      } else {
        // EQUAL
        pos += text.length;
      }
    }
  }

  /**
   * Convenience methods for common mutations
   */
  editNodeLabel(nodeId: string, newLabel: string): void {
    this.enqueue({ type: 'editNodeLabel', nodeId, newLabel });
  }

  changeNodeShape(nodeId: string, newShape: NodeShape): void {
    this.enqueue({ type: 'changeNodeShape', nodeId, newShape });
  }

  addNode(nodeId: string, label: string, shape: NodeShape, position?: { x: number; y: number }): void {
    this.enqueue({ type: 'addNode', nodeId, label, shape, position });
  }

  removeNode(nodeId: string): void {
    this.enqueue({ type: 'removeNode', nodeId });
  }

  addEdge(from: string, to: string, label?: string, arrowType?: ArrowType): void {
    this.enqueue({ type: 'addEdge', from, to, label, arrowType });
  }

  removeEdge(from: string, to: string): void {
    this.enqueue({ type: 'removeEdge', from, to });
  }

  groupNodes(nodeIds: string[], label?: string): void {
    this.enqueue({ type: 'groupNodes', nodeIds, label });
  }

  ungroupSubgraph(subgraphId: string): void {
    this.enqueue({ type: 'ungroupSubgraph', subgraphId });
  }

  /**
   * Dispose of the mutation queue
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.queue = [];
  }
}

/**
 * Create a new MutationQueue instance
 */
export function createMutationQueue(yText: Y.Text): MutationQueue {
  return new MutationQueue(yText);
}
