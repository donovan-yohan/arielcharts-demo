/**
 * MCP server with StreamableHTTP transport
 * Implements read_diagram, write_diagram, and list_sessions tools
 */

import { Server } from '@modelcontextprotocol/sdk/dist/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/dist/server/streamableHttp.js';
import { z } from 'zod';
import { sessionManager } from './session-manager.js';
import { config } from './env.js';
import type { Request, Response } from 'express';
import { getCorsHeaders } from './origin.js';

// Tool input schemas
const ReadDiagramInputSchema = z.object({
  session_id: z.string().regex(config.session.idPattern),
});

const WriteDiagramInputSchema = z.object({
  session_id: z.string().regex(config.session.idPattern),
  mermaid_text: z.string().max(100000),
});

// MCP Server instance
let mcpServer: Server | null = null;
let transport: StreamableHTTPServerTransport | null = null;

export function createMCPServer(): Server {
  if (mcpServer) {
    return mcpServer;
  }

  mcpServer = new Server(
    {
      name: 'arielcharts',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool handlers
  mcpServer.setRequestHandler('tools/list', async () => {
    return {
      tools: [
        {
          name: 'read_diagram',
          description: 'Read the current Mermaid diagram from a session',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'The session ID to read from',
                pattern: '^[a-z0-9_-]{6,32}$',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'write_diagram',
          description: 'Write a Mermaid diagram to a session',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'The session ID to write to',
                pattern: '^[a-z0-9_-]{6,32}$',
              },
              mermaid_text: {
                type: 'string',
                description: 'The Mermaid diagram text to write',
              },
            },
            required: ['session_id', 'mermaid_text'],
          },
        },
        {
          name: 'list_sessions',
          description: 'List all active and persisted sessions',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  mcpServer.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'read_diagram':
        return handleReadDiagram(args);
      case 'write_diagram':
        return handleWriteDiagram(args);
      case 'list_sessions':
        return handleListSessions();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return mcpServer;
}

async function handleReadDiagram(args: unknown) {
  const parsed = ReadDiagramInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid input: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const { session_id } = parsed.data;

  // Check if session exists
  if (!sessionManager.sessionExists(session_id)) {
    return {
      content: [
        {
          type: 'text',
          text: `Session "${session_id}" not found`,
        },
      ],
      isError: true,
    };
  }

  const info = sessionManager.getSessionInfo(session_id);
  if (!info) {
    return {
      content: [
        {
          type: 'text',
          text: `Failed to read session "${session_id}"`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          mermaid_text: info.mermaidText,
          participants: info.participants,
        } satisfies import('@arielcharts/shared').ReadDiagramOutput),
      },
    ],
  };
}

async function handleWriteDiagram(args: unknown) {
  const parsed = WriteDiagramInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid input: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const { session_id, mermaid_text } = parsed.data;

  // Validate mermaid text has some content
  if (!mermaid_text.trim()) {
    return {
      content: [
        {
          type: 'text',
          text: 'Mermaid text cannot be empty',
        },
      ],
      isError: true,
    };
  }

  try {
    const success = sessionManager.writeDiagram(session_id, mermaid_text, {
      name: 'AI Agent',
      type: 'agent',
    });

    if (!success) {
      return {
        content: [
          {
            type: 'text',
            text: 'Failed to write diagram',
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
          } satisfies import('@arielcharts/shared').WriteDiagramOutput),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: `Error writing diagram: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleListSessions() {
  const sessions = sessionManager.listSessions();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sessions: sessions.map(s => ({
            id: s.id,
            title: s.title,
            participants: s.participants,
          })),
        } satisfies import('@arielcharts/shared').ListSessionsOutput),
      },
    ],
  };
}

/**
 * Handle MCP HTTP requests
 */
export async function handleMCPRequest(req: Request, res: Response): Promise<void> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const corsHeaders = getCorsHeaders(req);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    res.status(204).end();
    return;
  }

  // Set CORS headers
  const corsHeaders = getCorsHeaders(req);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  try {
    const server = createMCPServer();

    // Create transport for this request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      onsessioninitialized: () => {},
    });

    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request error:', err);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
}

/**
 * Clean up MCP server
 */
export function cleanupMCPServer(): void {
  if (transport) {
    transport.close?.();
    transport = null;
  }
  mcpServer = null;
}
