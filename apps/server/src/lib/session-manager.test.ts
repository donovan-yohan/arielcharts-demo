import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Persistence } from './persistence';
import { SessionManager } from './session-manager';

let databasePath: string;

beforeEach(() => {
  databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arielcharts-server-test-')), 'test.db');
});

describe('SessionManager', () => {
  it('creates and lists sessions', () => {
    const manager = new SessionManager(new Persistence(databasePath), 60_000);
    const session = manager.getOrCreateSession('sample_1');

    expect(session.text.toString()).toContain('flowchart TD');
    expect(manager.listSessions()).toEqual([
      expect.objectContaining({ id: 'sample_1' }),
    ]);
  });

  it('writes diagrams through MCP-facing API', () => {
    const manager = new SessionManager(new Persistence(databasePath), 60_000);
    manager.writeDiagram('sample_1', 'flowchart TD\n  a[Alpha] --> b[Beta]', {
      name: 'Agent',
      color: '#3fb950',
      type: 'agent',
    });

    expect(manager.readDiagram('sample_1').mermaid_text).toContain('Alpha');
    expect(manager.getActivity('sample_1').at(-1)?.action).toBe('replaced');
  });
});
