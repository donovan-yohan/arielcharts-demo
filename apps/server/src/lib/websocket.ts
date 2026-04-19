import { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as map from 'lib0/map';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { nanoid } from 'nanoid';
import type { ActivityEvent, Participant } from '@arielcharts/shared';
import { SessionManager } from './session-manager';

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;

export function createWebSocketServer(sessionManager: SessionManager) {
  const webSocketServer = new WebSocketServer({ noServer: true });

  webSocketServer.on('connection', (socket, request) => {
    const roomId = request.url?.split('/').pop();
    if (!roomId) {
      socket.close();
      return;
    }

    const session = sessionManager.getOrCreateSession(roomId);
    const awareness = session.awareness;
    const callbacks = new Map<string, () => void>();

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === socket) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      send(socket, encoding.toUint8Array(encoder));
    };

    session.doc.on('update', updateHandler);

    const awarenessUpdateHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));

      for (const client of webSocketServer.clients) {
        if (client.readyState === client.OPEN && client !== socket) {
          send(client, encoding.toUint8Array(encoder));
        }
      }
    };

    awareness.on('update', awarenessUpdateHandler);

    socket.on('message', (data) => {
      handleMessage(socket, session.doc, awareness, data, roomId, sessionManager, request);
    });

    socket.on('close', () => {
      session.doc.off('update', updateHandler);
      awareness.off('update', awarenessUpdateHandler);
      awarenessProtocol.removeAwarenessStates(awareness, [session.doc.clientID], null);
      for (const dispose of callbacks.values()) {
        dispose();
      }
    });

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, session.doc);
    send(socket, encoding.toUint8Array(encoder));

    const awarenessStates = Array.from(awareness.getStates().keys());
    if (awarenessStates.length > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(awareness, awarenessStates));
      send(socket, encoding.toUint8Array(awarenessEncoder));
    }
  });

  return webSocketServer;
}

function handleMessage(
  socket: WebSocket,
  doc: Y.Doc,
  awareness: awarenessProtocol.Awareness,
  data: RawData,
  roomId: string,
  sessionManager: SessionManager,
  request: IncomingMessage,
) {
  const decoder = decoding.createDecoder(new Uint8Array(data as ArrayBuffer));
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case messageSync:
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
      if (encoding.length(encoder) > 1) {
        send(socket, encoding.toUint8Array(encoder));
      }
      break;
    case messageAwareness: {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(awareness, update, socket);
      for (const [clientId, state] of awareness.getStates()) {
        const user = (state as { user?: Participant }).user;
        if (user) {
          sessionManager.touchParticipant(roomId, clientId, user);
        }
      }
      sessionManager.addActivity(roomId, {
        id: nanoid(),
        timestamp: Date.now(),
        actor: {
          name: request.headers['x-user-name']?.toString() ?? 'Collaborator',
          type: request.headers['x-user-type'] === 'agent' ? 'agent' : 'human',
        },
        action: 'edited',
        detail: 'Updated live presence',
      } satisfies ActivityEvent);
      break;
    }
    case messageQueryAwareness: {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys())),
      );
      send(socket, encoding.toUint8Array(awarenessEncoder));
      break;
    }
  }
}

function send(socket: WebSocket, payload: Uint8Array) {
  if (socket.readyState === socket.OPEN) {
    socket.send(payload, { binary: true });
  }
}
