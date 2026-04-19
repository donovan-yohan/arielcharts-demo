import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { setupWSConnection } from 'y-websocket/bin/utils.js';
import { getOrCreateSession } from './session-manager.js';

export function setupWebSocketServer(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const roomId = match[1];
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit('connection', ws, req, roomId);
    });
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage, roomId: string) => {
    const session = getOrCreateSession(roomId);
    session.participants++;
    setupWSConnection(ws as any, req, { docName: roomId, gc: true });
    ws.on('close', () => { session.participants = Math.max(0, session.participants - 1); });
  });
}
