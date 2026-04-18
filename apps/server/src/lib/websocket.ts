/**
 * WebSocket server for Yjs CRDT sync
 * Implements y-websocket compatible protocol
 */

import type { WebSocket } from 'ws';
import * as Y from 'yjs';
import { encoding, decoding } from 'lib0';
import { sessionManager } from './session-manager.js';
import type { Participant, AwarenessState } from '@arielcharts/shared';
import { config } from './env.js';
import { isOriginAllowed } from './origin.js';

// y-websocket message types
const MESSAGE_TYPE_SYNC = 0;
const MESSAGE_TYPE_AWARENESS = 1;
const MESSAGE_TYPE_QUERY_AWARENESS = 3;

// Sync message subtypes
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

interface YjsWebSocket extends WebSocket {
  sessionId?: string;
  participant?: Participant;
}

export class YjsWebSocketServer {
  private wss: WebSocket.Server | null = null;

  setup(wss: WebSocket.Server): void {
    this.wss = wss;

    wss.on('connection', (ws: YjsWebSocket, req) => {
      // Validate origin
      const origin = req.headers.origin;
      if (!isOriginAllowed(origin)) {
        ws.close(1008, 'Origin not allowed');
        return;
      }

      // Extract session ID from URL
      const sessionId = this.extractSessionId(req.url);
      if (!sessionId || !config.session.idPattern.test(sessionId)) {
        ws.close(1008, 'Invalid session ID');
        return;
      }

      // Get or create session
      const session = sessionManager.getOrCreateSession(sessionId);
      ws.sessionId = sessionId;

      // Set up message handlers
      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, data, session.yjsDoc, session.awareness);
      });

      ws.on('close', () => {
        this.handleClose(ws, session.awareness);
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
      });

      // Send initial sync step 1
      this.sendSyncStep1(ws, session.yjsDoc);

      // Send current awareness states
      this.sendAwarenessSnapshot(ws, session.awareness);
    });
  }

  private extractSessionId(url: string | undefined): string | null {
    if (!url) return null;
    
    // Parse URL like /ws/:roomId
    const match = url.match(/^\/ws\/([a-z0-9_-]{6,32})$/);
    return match?.[1] ?? null;
  }

  private handleMessage(
    ws: YjsWebSocket,
    data: Buffer,
    yjsDoc: Y.Doc,
    awareness: Y.Awareness
  ): void {
    try {
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MESSAGE_TYPE_SYNC:
          this.handleSyncMessage(ws, decoder, yjsDoc);
          break;
        case MESSAGE_TYPE_AWARENESS:
          this.handleAwarenessMessage(ws, decoder, awareness);
          break;
        case MESSAGE_TYPE_QUERY_AWARENESS:
          this.handleQueryAwareness(ws, awareness);
          break;
        default:
          console.warn('Unknown message type:', messageType);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  }

  private handleSyncMessage(
    ws: YjsWebSocket,
    decoder: decoding.Decoder,
    yjsDoc: Y.Doc
  ): void {
    const syncType = decoding.readVarUint(decoder);

    switch (syncType) {
      case SYNC_STEP1:
        // Client is requesting sync step 1 - send our state vector
        this.sendSyncStep1(ws, yjsDoc);
        break;
      case SYNC_STEP2:
        // Client sent their state - apply it and send any missing updates
        const update = decoding.readVarUint8Array(decoder);
        Y.applyUpdate(yjsDoc, update);
        
        // Send back any updates the client is missing
        const stateVector = Y.encodeStateAsVector(yjsDoc);
        const diff = Y.encodeStateAsUpdate(yjsDoc, stateVector);
        this.sendSyncStep2(ws, diff);
        break;
      case SYNC_UPDATE:
        // Regular update from client
        const updateData = decoding.readVarUint8Array(decoder);
        Y.applyUpdate(yjsDoc, updateData);
        
        // Broadcast to other clients
        this.broadcastSyncUpdate(ws, updateData);
        break;
    }
  }

  private handleAwarenessMessage(
    ws: YjsWebSocket,
    decoder: decoding.Decoder,
    awareness: Y.Awareness
  ): void {
    const update = decoding.readVarUint8Array(decoder);
    
    // Apply awareness update
    Y.applyAwarenessUpdate(awareness, update, ws);

    // Extract participant info from awareness
    const states = awareness.getStates();
    const clientId = awareness.clientID;
    const state = states.get(clientId) as AwarenessState | undefined;
    
    if (state?.user && !ws.participant) {
      ws.participant = state.user;
      
      // Record participant joined
      if (ws.sessionId) {
        sessionManager.recordParticipantJoined(ws.sessionId, state.user);
      }
    }

    // Broadcast to other clients
    this.broadcastAwarenessUpdate(ws, update);
  }

  private handleQueryAwareness(ws: YjsWebSocket, awareness: Y.Awareness): void {
    this.sendAwarenessSnapshot(ws, awareness);
  }

  private handleClose(ws: YjsWebSocket, awareness: Y.Awareness): void {
    // Remove client from awareness
    if (ws.participant && ws.sessionId) {
      sessionManager.recordParticipantLeft(ws.sessionId, ws.participant);
    }
    
    // Remove this client from awareness states
    awareness.setLocalState(null);
  }

  private sendSyncStep1(ws: YjsWebSocket, yjsDoc: Y.Doc): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE_SYNC);
    encoding.writeVarUint(encoder, SYNC_STEP1);
    
    const stateVector = Y.encodeStateAsVector(yjsDoc);
    encoding.writeVarUint8Array(encoder, stateVector);
    
    this.send(ws, encoding.toUint8Array(encoder));
  }

  private sendSyncStep2(ws: YjsWebSocket, update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE_SYNC);
    encoding.writeVarUint(encoder, SYNC_STEP2);
    encoding.writeVarUint8Array(encoder, update);
    
    this.send(ws, encoding.toUint8Array(encoder));
  }

  private sendAwarenessSnapshot(ws: YjsWebSocket, awareness: Y.Awareness): void {
    const states = Array.from(awareness.getStates().entries());
    const update = Y.encodeAwarenessUpdate(awareness, states.map(([id]) => id));
    
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    
    this.send(ws, encoding.toUint8Array(encoder));
  }

  private broadcastSyncUpdate(originWs: YjsWebSocket, update: Uint8Array): void {
    if (!this.wss) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE_SYNC);
    encoding.writeVarUint(encoder, SYNC_UPDATE);
    encoding.writeVarUint8Array(encoder, update);
    const message = encoding.toUint8Array(encoder);

    this.broadcast(originWs, message);
  }

  private broadcastAwarenessUpdate(originWs: YjsWebSocket, update: Uint8Array): void {
    if (!this.wss) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    const message = encoding.toUint8Array(encoder);

    this.broadcast(originWs, message);
  }

  private broadcast(originWs: YjsWebSocket, message: Uint8Array): void {
    if (!this.wss) return;

    this.wss.clients.forEach((client) => {
      const c = client as YjsWebSocket;
      if (c !== originWs && c.readyState === 1 && c.sessionId === originWs.sessionId) {
        this.send(c, message);
      }
    });
  }

  private send(ws: YjsWebSocket, message: Uint8Array): void {
    if (ws.readyState === 1) {
      try {
        ws.send(message);
      } catch (err) {
        console.error('Error sending WebSocket message:', err);
      }
    }
  }
}

// Singleton instance
export const yjsWebSocketServer = new YjsWebSocketServer();
