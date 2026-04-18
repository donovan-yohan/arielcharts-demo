/**
 * ArielCharts Node.js Backend Server
 * 
 * Features:
 * - Express HTTP server
 * - WebSocket server for Yjs CRDT sync at /ws/:roomId
 * - MCP server with StreamableHTTP transport at /mcp
 * - Session management with Yjs document lifecycle
 * - SQLite persistence for Yjs document state
 * - Activity event tracking
 * - Origin validation for CORS
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';

import { env, config } from './lib/env.js';
import { isOriginAllowed, getCorsHeaders } from './lib/origin.js';
import { yjsWebSocketServer } from './lib/websocket.js';
import { handleMCPRequest, cleanupMCPServer } from './lib/mcp.js';
import { sessionManager } from './lib/session-manager.js';
import { persistence } from './lib/persistence.js';

// Create Express app
const app = express();

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb', type: 'text/plain' }));
app.use(express.raw({ limit: '1mb', type: 'application/octet-stream' }));

// CORS middleware
app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '0.1.0',
  });
});

// Session info endpoint (REST API for debugging)
app.get('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (!config.session.idPattern.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session ID format' });
    return;
  }

  const info = sessionManager.getSessionInfo(sessionId);
  if (!info) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({
    id: info.id,
    title: info.title,
    participants: info.participants,
    mermaidText: info.mermaidText,
  });
});

// List sessions endpoint
app.get('/api/sessions', (_req, res) => {
  const sessions = sessionManager.listSessions();
  res.json({ sessions });
});

// Activity events endpoint
app.get('/api/sessions/:sessionId/activity', (req, res) => {
  const { sessionId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  
  if (!config.session.idPattern.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session ID format' });
    return;
  }

  const events = sessionManager.getActivityEvents(sessionId, limit);
  res.json({ events });
});

// MCP endpoint
app.all('/mcp', (req, res) => {
  handleMCPRequest(req, res).catch((err) => {
    console.error('Unhandled MCP error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Create HTTP server
const httpServer = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  verifyClient: (info, done) => {
    // Verify origin
    const origin = info.origin;
    if (isOriginAllowed(origin)) {
      done(true);
    } else {
      done(false, 403, 'Origin not allowed');
    }
  },
});

// Set up Yjs WebSocket server
yjsWebSocketServer.setup(wss);

// Handle upgrade manually for path-based routing
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
  
  if (pathname.startsWith('/ws/')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Start server
httpServer.listen(env.PORT, env.HOST, () => {
  console.log(`🚀 ArielCharts server running on http://${env.HOST}:${env.PORT}`);
  console.log(`📊 Environment: ${env.NODE_ENV}`);
  console.log(`🔄 WebSocket endpoint: ws://localhost:${env.PORT}/ws/:roomId`);
  console.log(`🤖 MCP endpoint: http://localhost:${env.PORT}/mcp`);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  // Close HTTP server
  httpServer.close(() => {
    console.log('HTTP server closed');
  });

  // Close WebSocket server
  wss.close(() => {
    console.log('WebSocket server closed');
  });

  // Clean up MCP server
  cleanupMCPServer();

  // Clean up session manager
  sessionManager.destroy();

  // Close persistence
  persistence.close();

  // Exit after cleanup
  setTimeout(() => {
    console.log('Cleanup complete. Exiting.');
    process.exit(0);
  }, 1000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
