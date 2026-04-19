import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadAllSessions, loadSession } from './persistence';
import {
  getOrCreateDoc,
  getMermaidText,
  getConnectionCount,
  getSessionTitle,
  writeMermaidText,
  isValidSessionId,
} from './session-manager';
import type {
  ReadDiagramOutput,
  WriteDiagramOutput,
  ListSessionsOutput,
  Participant,
} from '@arielcharts/shared';

/**
 * Build and return a configured McpServer with all ArielCharts tools registered.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'ArielCharts',
    version: '0.1.0',
  });

  // ── read_diagram ──────────────────────────────────────────────────────────
  server.tool(
    'read_diagram',
    'Read the current Mermaid diagram text and active participant list for a session.',
    {
      session_id: z.string().min(6).max(32).describe('The session ID to read from'),
    },
    async ({ session_id }): Promise<{ content: { type: 'text'; text: string }[] }> => {
      if (!isValidSessionId(session_id)) {
        return errorResult(`Invalid session_id format: "${session_id}"`);
      }

      const row = loadSession(session_id);
      if (!row) {
        return errorResult(`Session "${session_id}" not found`);
      }

      const doc = getOrCreateDoc(session_id);
      const yText = getMermaidText(doc);
      const mermaidText = yText.toString();

      // Build a minimal participants list from awareness (we only have count here).
      // The full awareness state lives in the WS layer; MCP gives a best-effort view.
      const participants: Participant[] = [];

      const output: ReadDiagramOutput = {
        mermaid_text: mermaidText,
        participants,
      };

      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    },
  );

  // ── write_diagram ─────────────────────────────────────────────────────────
  server.tool(
    'write_diagram',
    'Replace the Mermaid diagram text for a session. Appends an ActivityEvent and persists the state.',
    {
      session_id: z.string().min(6).max(32).describe('The session ID to write to'),
      mermaid_text: z.string().describe('The new Mermaid diagram text'),
      actor_name: z
        .string()
        .optional()
        .describe('Display name of the agent making the edit (optional)'),
    },
    async ({
      session_id,
      mermaid_text,
      actor_name,
    }): Promise<{ content: { type: 'text'; text: string }[] }> => {
      if (!isValidSessionId(session_id)) {
        return errorResult(`Invalid session_id format: "${session_id}"`);
      }

      const row = loadSession(session_id);
      if (!row) {
        return errorResult(`Session "${session_id}" not found`);
      }

      const actorDisplayName = actor_name ?? 'Agent';
      writeMermaidText(session_id, mermaid_text, actorDisplayName);

      const output: WriteDiagramOutput = { success: true };
      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    },
  );

  // ── list_sessions ─────────────────────────────────────────────────────────
  server.tool(
    'list_sessions',
    'List all ArielCharts sessions ordered by most recently updated.',
    {},
    async (): Promise<{ content: { type: 'text'; text: string }[] }> => {
      const rows = loadAllSessions();

      const sessions = rows.map((row) => ({
        id: row.id,
        title: getSessionTitle(row.id) || row.title || row.id,
        participants: getConnectionCount(row.id),
      }));

      const output: ListSessionsOutput = { sessions };
      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    },
  );

  return server;
}

function errorResult(message: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }] };
}
