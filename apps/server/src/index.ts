import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { readEnv } from './lib/env';
import { assertAllowedOrigin } from './lib/origin';
import { Persistence } from './lib/persistence';
import { SessionManager } from './lib/session-manager';
import { createWebSocketServer } from './lib/websocket';
import { createMcpTransport } from './lib/mcp';

async function main() {
  const env = readEnv();
  fs.mkdirSync(env.dataDir, { recursive: true });

  const persistence = new Persistence(env.databasePath);
  const sessionManager = new SessionManager(persistence, env.sessionTtlMs);
  const app = express();
  const server = http.createServer(app);
  const webSocketServer = createWebSocketServer(sessionManager);
  const mcpTransport = await createMcpTransport(sessionManager);

  app.use(cors({ origin: env.allowedOrigins }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/api/sessions/:sessionId', (request, response) => {
    response.json({
      sessionId: request.params.sessionId,
      origin: env.origin,
      diagram: sessionManager.readDiagram(request.params.sessionId),
      activity: sessionManager.getActivity(request.params.sessionId),
    });
  });

  app.options('/mcp', (request, response) => {
    if (!assertAllowedOrigin(request, response, env.allowedOrigins)) {
      return;
    }
    response.status(204).end();
  });

  app.post('/mcp', async (request, response) => {
    if (!assertAllowedOrigin(request, response, env.allowedOrigins)) {
      return;
    }
    await mcpTransport.handleRequest(request, response, request.body);
  });

  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/ws/')) {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (ws) => {
      webSocketServer.emit('connection', ws, request);
    });
  });

  server.listen(env.port, env.host, () => {
    console.log(`ArielCharts server listening on ${env.host}:${env.port}`);
  });

  setInterval(() => {
    sessionManager.cleanupExpiredSessions();
  }, 60_000).unref();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
