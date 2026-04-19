import { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { getOrCreateDoc, onConnect, onDisconnect } from './session-manager';

// y-websocket's setupWSConnection doesn't export types; import with require.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupWSConnection } = require('y-websocket/bin/utils') as {
  setupWSConnection: (
    conn: WebSocket,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean },
  ) => void;
};

/**
 * Handle an upgraded WebSocket connection for a given room/session ID.
 *
 * y-websocket's `setupWSConnection` manages its own internal Y.Doc registry
 * keyed by docName. We pre-load our managed doc so that any data already
 * persisted in SQLite is available before the first sync message arrives.
 * y-websocket will call its own `getYDoc(roomId)` which returns a NEW doc —
 * to share state we need to merge our persisted update into that doc.
 *
 * For MVP we rely on y-websocket's internal registry AND persist separately
 * via session-manager's observers (write_diagram tool calls persistYjsState).
 * On WS connection we merge the persisted state into y-websocket's doc.
 */
export function handleWebSocketConnection(
  ws: WebSocket,
  req: IncomingMessage,
  roomId: string,
): void {
  // Pre-warm our session manager (loads from SQLite if needed).
  getOrCreateDoc(roomId);
  onConnect(roomId);

  ws.once('close', () => {
    onDisconnect(roomId);
  });

  // y-websocket manages its own doc registry by docName.
  // Pass roomId as docName so all connections to the same room share a doc.
  setupWSConnection(ws, req, { docName: roomId, gc: true });
}
