export interface Participant {
  name: string;
  color: string;
  type: 'human' | 'agent';
}

export interface AwarenessState {
  user: Participant;
  cursor?: { anchor: number; head: number };
}

export interface ActivityEvent {
  id: string;
  timestamp: number;
  actor: { name: string; type: 'human' | 'agent' };
  action: 'joined' | 'left' | 'edited' | 'replaced';
  detail?: string;
}

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

export interface SessionSnapshot {
  id: string;
  mermaidText: string;
  updatedAt: number;
  title: string;
  participants: Participant[];
  activity: ActivityEvent[];
}

export const SESSION_ID_PATTERN = /^[a-z0-9_-]{6,32}$/;
export const DEFAULT_DIAGRAM = `flowchart TD\n    start([Start]) --> input[Collect requirements]\n    input --> decide{Need review?}\n    decide -->|Yes| review[Review draft]\n    decide -->|No| done([Done])\n    review --> done`;
export const MAX_ACTIVITY_EVENTS = 200;
