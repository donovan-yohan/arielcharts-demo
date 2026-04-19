import { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
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
  const roomSockets = new Map<string, Set<WebSocket>>();

  webSocketServer.on('connection', (socket, request) => {
    const roomId = request.url?.split('?')[0]?.split('/').pop();
    if (!roomId) {
      socket.close();
      return;
    }

    const session = sessionManager.getOrCreateSession(roomId);
    const awareness = session.awareness;
    const trackedClientIds = new Set<number>();
    const sockets = roomSockets.get(roomId) ?? new Set<WebSocket>();
    sockets.add(socket);
    roomSockets.set(roomId, sockets);

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

    const awarenessUpdateHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === socket) {
        return;
      }
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));

      for (const client of roomSockets.get(roomId) ?? []) {
        if (client.readyState === client.OPEN && client !== socket) {
          send(client, encoding.toUint8Array(encoder));
        }
      }
    };

    awareness.on('update', awarenessUpdateHandler);

    socket.on('message', (data) => {
      handleMessage(socket, session.doc, awareness, data, roomId, sessionManager, trackedClientIds);
    });

    socket.on('close', () => {
      session.doc.off('update', updateHandler);
      awareness.off('update', awarenessUpdateHandler);

      const removedIds = [...trackedClientIds];
      if (removedIds.length > 0) {
        awarenessProtocol.removeAwarenessStates(awareness, removedIds, socket);
        for (const clientId of removedIds) {
          const previous = sessionManager.getParticipant(roomId, clientId);
          sessionManager.touchParticipant(roomId, clientId, null);
          if (previous) {
            sessionManager.addActivity(roomId, {
              id: nanoid(),
              timestamp: Date.now(),
              actor: { name: previous.name, type: previous.type },
              action: 'left',
              detail: 'Left session',
            } satisfies ActivityEvent);
          }
        }
      }

      const roomClients = roomSockets.get(roomId);
      roomClients?.delete(socket);
      if (roomClients?.size === 0) {
        roomSockets.delete(roomId);
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
  trackedClientIds: Set<number>,
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
      const states = decodeAwarenessStates(update);
      awarenessProtocol.applyAwarenessUpdate(awareness, update, socket);

      for (const state of states) {
        trackedClientIds.add(state.clientId);
        const previous = sessionManager.getParticipant(roomId, state.clientId);
        const participant = state.state?.user ?? null;
        sessionManager.touchParticipant(roomId, state.clientId, participant);

        if (!previous && participant) {
          sessionManager.addActivity(roomId, {
            id: nanoid(),
            timestamp: Date.now(),
            actor: { name: participant.name, type: participant.type },
            action: 'joined',
            detail: 'Joined session',
          } satisfies ActivityEvent);
        } else if (previous && !participant) {
          sessionManager.addActivity(roomId, {
            id: nanoid(),
            timestamp: Date.now(),
            actor: { name: previous.name, type: previous.type },
            action: 'left',
            detail: 'Left session',
          } satisfies ActivityEvent);
        }
      }
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

function decodeAwarenessStates(update: Uint8Array) {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const states: Array<{ clientId: number; state: { user?: Participant } | null }> = [];

  for (let index = 0; index < count; index += 1) {
    const clientId = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    states.push({
      clientId,
      state: JSON.parse(decoding.readVarString(decoder)) as { user?: Participant } | null,
    });
  }

  return states;
}

function send(socket: WebSocket, payload: Uint8Array) {
  if (socket.readyState === socket.OPEN) {
    socket.send(payload, { binary: true });
  }
}
