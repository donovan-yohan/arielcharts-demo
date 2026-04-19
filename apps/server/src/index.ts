import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PORT, ALLOWED_ORIGINS } from './lib/env';
import { isOriginAllowed, corsHeaders } from './lib/origin';
import { ensureSession, loadSession } from './lib/persistence';
import { createSession, isValidSessionId, cleanupIdleSessions } from './lib/session-manager';
import { handleWebSocketConnection } from './lib/websocket';
import { createMcpServer } from './lib/mcp';

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

// Standard JSON body parsing
app.use(express.json());

// CORS for REST routes
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin "${origin}" not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  }),
);

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// ── Session REST API ──────────────────────────────────────────────────────────

/** POST /api/sessions — create a new session */
app.post('/api/sessions', (req: Request, res: Response) => {
  const title: string =
    typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : 'Untitled diagram';

  const session = createSession(title);
  res.status(201).json(session);
});

/** GET /api/sessions/:id — get session info */
app.get('/api/sessions/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id || !isValidSessionId(id)) {
    res.status(400).json({ error: 'Invalid session ID format' });
    return;
  }

  const row = loadSession(id);
  if (!row) {
    res.status(404).json({ error: `Session "${id}" not found` });
    return;
  }

  res.status(200).json({ id: row.id, title: row.title, updated_at: row.updated_at });
});

// ── MCP endpoint ──────────────────────────────────────────────────────────────

const mcpServer = createMcpServer();

// OPTIONS /mcp — CORS preflight
app.options('/mcp', (req: Request, res: Response) => {
  const origin = req.headers['origin'];
  const headers = corsHeaders(origin);
  res.set(headers).status(204).send();
});

// POST /mcp — StreamableHTTP MCP transport
app.post('/mcp', async (req: Request, res: Response) => {
  const origin = req.headers['origin'];
  const headers = corsHeaders(origin);

  // Set CORS headers before anything else
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

  if (!isOriginAllowed(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless per-request
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] Error handling request:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal MCP error' });
    }
  }
});

// GET /mcp — SSE stream for MCP (Streamable HTTP also supports GET)
app.get('/mcp', async (req: Request, res: Response) => {
  const origin = req.headers['origin'];
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

  if (!isOriginAllowed(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] Error handling GET request:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal MCP error' });
    }
  }
});

// ── HTTP server + WebSocket upgrade ──────────────────────────────────────────

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req: http.IncomingMessage, socket, head) => {
  const url = req.url ?? '';

  // Match /ws/:roomId
  const wsMatch = url.match(/^\/ws\/([a-z0-9_-]{6,32})(?:\?.*)?$/);
  if (!wsMatch) {
    socket.destroy();
    return;
  }

  const roomId = wsMatch[1];
  if (!roomId) {
    socket.destroy();
    return;
  }

  // Validate origin for WebSocket connections
  const origin = req.headers['origin'];
  if (!isOriginAllowed(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  // Ensure session row exists before handling WS connection
  ensureSession(roomId, roomId);

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    handleWebSocketConnection(ws, req, roomId);
  });
});

// ── Periodic cleanup ──────────────────────────────────────────────────────────

// Run every 10 minutes; cleanupIdleSessions has internal early-return guard.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(cleanupIdleSessions, CLEANUP_INTERVAL_MS).unref();

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[ArielCharts] Server listening on port ${PORT}`);
  console.log(`[ArielCharts] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

export { app, server };
