import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM, SESSION_ID_PATTERN } from './types';

describe('shared contracts', () => {
  it('accepts spec-compliant session ids', () => {
    expect(SESSION_ID_PATTERN.test('abc123')).toBe(true);
    expect(SESSION_ID_PATTERN.test('abc_123-z')).toBe(true);
  });

  it('rejects invalid session ids', () => {
    expect(SESSION_ID_PATTERN.test('ABC123')).toBe(false);
    expect(SESSION_ID_PATTERN.test('a')).toBe(false);
    expect(SESSION_ID_PATTERN.test('drop table;')).toBe(false);
  });

  it('ships a usable default flowchart', () => {
    expect(DEFAULT_DIAGRAM.startsWith('flowchart TD')).toBe(true);
    expect(DEFAULT_DIAGRAM).toContain('done([Done])');
  });
});
