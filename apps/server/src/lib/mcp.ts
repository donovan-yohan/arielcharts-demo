import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getMermaidText, setMermaidText, getParticipants, listAllSessions } from './session-manager.js';
import { appendActivityEvent } from './persistence.js';
import type { Express, Request, Response } from 'express';

function createMcpServer() {
  const server = new McpServer({
    name: 'ArielCharts',
    version: '0.0.1',
  });

  server.tool('read_diagram', 'Read the current Mermaid diagram text for a session', {
    session_id: z.string().describe('Session ID'),
  }, async ({ session_id }) => {
    const text = getMermaidText(session_id);
    const participants = getParticipants(session_id);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ mermaid_text: text, participants }),
      }],
    };
  });

  server.tool('write_diagram', 'Replace the Mermaid diagram text for a session', {
    session_id: z.string().describe('Session ID'),
    mermaid_text: z.string().describe('New Mermaid diagram source'),
  }, async ({ session_id, mermaid_text }) => {
    setMermaidText(session_id, mermaid_text);
    appendActivityEvent(session_id, {
      id: uuidv4(),
      timestamp: Date.now(),
      actor_name: 'agent',
      actor_type: 'agent',
      action: 'replaced',
      detail: 'Diagram updated via MCP',
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true }),
      }],
    };
  });

  server.tool('list_sessions', 'List all available ArielCharts sessions', {}, async () => {
    const sessions = listAllSessions();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ sessions }),
      }],
    };
  });

  return server;
}

export function setupMcpRoutes(app: Express): void {
  // Map of session ID -> transport for stateful sessions
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.options('/mcp', (_req: Request, res: Response) => {
    res.status(204).end();
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => uuidv4(),
        onsessioninitialized: (sid) => { transports.set(sid, transport); },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'No session' });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'No session' });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  });
}
