import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Participant } from '@arielcharts/shared';
import { SessionManager } from './session-manager';

export async function createMcpTransport(sessionManager: SessionManager) {
  const server = new McpServer({
    name: 'arielcharts',
    version: '0.0.0',
  });

  server.registerTool(
    'read_diagram',
    {
      title: 'Read diagram',
      description: 'Read the current Mermaid diagram and active participants.',
      inputSchema: {
        session_id: z.string(),
      },
    },
    async ({ session_id }) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(sessionManager.readDiagram(session_id)),
        },
      ],
    }),
  );

  server.registerTool(
    'write_diagram',
    {
      title: 'Write diagram',
      description: 'Replace the Mermaid diagram for a session.',
      inputSchema: {
        session_id: z.string(),
        mermaid_text: z.string(),
      },
    },
    async ({ session_id, mermaid_text }) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            sessionManager.writeDiagram(session_id, mermaid_text, {
              name: 'MCP Agent',
              color: '#3fb950',
              type: 'agent',
            } satisfies Participant),
          ),
        },
      ],
    }),
  );

  server.registerTool(
    'list_sessions',
    {
      title: 'List sessions',
      description: 'List live and persisted ArielCharts sessions.',
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ sessions: sessionManager.listSessions() }),
        },
      ],
    }),
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport;
}
