import { describe, expect, it } from 'vitest';
import { applyDiff, parseDiagram } from './diagram-mutations';

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
    expect(parsed.edges).toEqual([{ from: 'a', to: 'b', label: undefined }]);
  });

  it('applies minimal text diffs', () => {
    const text = new FakeYText('hello world');
    applyDiff(text as never, 'hello world', 'hello brave world');
    expect(text.value).toBe('hello brave world');
  });
});
