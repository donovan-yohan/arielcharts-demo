/**
 * ArielCharts Shared Types
 * 
 * Core types shared between frontend and backend.
 */

/** Participant in a collaborative session */
export interface Participant {
  name: string;
  color: string;
  type: 'human' | 'agent';
}

/** Awareness state broadcast via Yjs */
export interface AwarenessState {
  user: Participant;
  cursor?: { anchor: number; head: number };
}

/** Activity event for the activity feed */
export interface ActivityEvent {
  id: string;
  timestamp: number;
  actor: { name: string; type: 'human' | 'agent' };
  action: 'joined' | 'left' | 'edited' | 'replaced';
  detail?: string;
}

/** MCP Tool Input/Output Types */
export interface ReadDiagramInput {
  session_id: string;
}

export interface ReadDiagramOutput {
  mermaid_text: string;
  participants: Participant[];
}

export interface WriteDiagramInput {
  session_id: string;
  mermaid_text: string;
}

export interface WriteDiagramOutput {
  success: boolean;
}

export interface ListSessionsOutput {
  sessions: { id: string; title: string; participants: number }[];
}

/** Session configuration */
export interface SessionConfig {
  id: string;
  websocketUrl: string;
}

/** Node shape types supported for visual editing */
export type NodeShape = 
  | 'rect'
  | 'roundRect'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'asymmetric'
  | 'rhombus'
  | 'hexagon'
  | 'parallelogram';

/** Edge arrow types */
export type ArrowType = 'arrow' | 'open' | 'dot' | 'none';

/** Diagram mutation operations */
export interface NodeMutation {
  type: 'editLabel' | 'changeShape' | 'add' | 'remove';
  nodeId: string;
  newLabel?: string;
  newShape?: NodeShape;
  position?: { x: number; y: number };
}

export interface EdgeMutation {
  type: 'add' | 'remove' | 'editLabel';
  from: string;
  to: string;
  label?: string;
  arrowType?: ArrowType;
}

export interface SubgraphMutation {
  type: 'group' | 'ungroup';
  nodeIds: string[];
  label?: string;
}

export type DiagramMutation = NodeMutation | EdgeMutation | SubgraphMutation;
