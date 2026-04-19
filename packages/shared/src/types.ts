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

export interface ReadDiagramInput  { session_id: string }
export interface ReadDiagramOutput { mermaid_text: string; participants: Participant[] }
export interface WriteDiagramInput { session_id: string; mermaid_text: string }
export interface WriteDiagramOutput { success: boolean }
export interface ListSessionsOutput { sessions: { id: string; title: string; participants: number }[] }
