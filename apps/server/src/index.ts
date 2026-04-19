import express from 'express';
import cors from 'cors';
import http from 'http';
import { PORT, ALLOWED_ORIGINS } from './lib/env.js';
import { isAllowedOrigin } from './lib/origin.js';
import { setupWebSocketServer } from './lib/websocket.js';
import { setupMcpRoutes } from './lib/mcp.js';
import { getOrCreateSession, generateSessionId, listAllSessions } from './lib/session-manager.js';
import { getDb } from './lib/persistence.js';

const app = express();

app.use(cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Create a new session
app.post('/sessions', (_req, res) => {
  const id = generateSessionId();
  getOrCreateSession(id);
  res.json({ id });
});

// List all sessions
app.get('/sessions', (_req, res) => {
  res.json({ sessions: listAllSessions() });
});

// MCP routes
setupMcpRoutes(app);

const server = http.createServer(app);
setupWebSocketServer(server);

// Initialize DB
getDb();

server.listen(PORT, () => {
  console.log(`ArielCharts server listening on :${PORT}`);
});
