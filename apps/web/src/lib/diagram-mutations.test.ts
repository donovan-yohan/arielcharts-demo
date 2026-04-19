import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MutationQueue, applyDiff, parseDiagram } from './diagram-mutations';

class FakeYText {
  value: string;
  constructor(value: string) {
    this.value = value;
  }
  delete(index: number, length: number) {
    this.value = this.value.slice(0, index) + this.value.slice(index + length);
  }
  insert(index: number, text: string) {
    this.value = this.value.slice(0, index) + text + this.value.slice(index);
  }
}

describe('diagram mutations helpers', () => {
  it('parses flowchart nodes and edges', () => {
    const parsed = parseDiagram('flowchart TD\n  a[Alpha] --> b{Beta}');
    expect(parsed.kind).toBe('flowchart');
    expect(parsed.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(parsed.edges).toEqual([{ from: 'a', to: 'b', label: undefined, arrowType: '-->' }]);
  });

  it('applies minimal text diffs', () => {
    const text = new FakeYText('hello world');
    applyDiff(text as never, 'hello world', 'hello brave world');
    expect(text.value).toBe('hello brave world');
  });

  it('preserves comments and subgraphs when mutating supported nodes', async () => {
    const doc = new Y.Doc();
    const text = doc.getText('mermaid');
    text.insert(
      0,
      ['flowchart TD', '    %% keep this comment', '    subgraph cluster[Review]', '      a[Alpha]', '    end', '    a --> b[Beta]'].join('\n'),
    );
    const queue = new MutationQueue(text);

    await queue.editNodeLabel('a', 'Renamed alpha');
    await queue.changeNodeShape('b', 'diamond');
    await queue.addEdge('b', 'a', 'feedback', '==>');

    const next = text.toString();
    expect(next).toContain('%% keep this comment');
    expect(next).toContain('subgraph cluster[Review]');
    expect(next).toContain('a[Renamed alpha]');
    expect(next).toContain('b{Beta}');
    expect(next).toContain('b ==> |feedback| a');
  });
});
