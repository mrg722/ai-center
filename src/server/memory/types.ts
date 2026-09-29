export type MemoryScope = 'global' | 'project' | 'agent' | 'task' | 'conversation';
export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'project'
  | 'decision'
  | 'preference'
  | 'fact'
  | 'lesson'
  | 'security_finding'
  | 'task_state';
export type MemorySource = 'user' | 'agent' | 'system' | 'extraction';

export interface MemoryRow {
  id: string;
  scope: MemoryScope;
  project_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  conversation_id: string | null;
  type: MemoryType;
  content: string;
  summary: string;
  importance: number;
  source: MemorySource;
  created_by_user: string | null;
  created_by_agent: string | null;
  pinned: boolean;
  archived: boolean;
  metadata: Record<string, unknown>;
  embedding: number[] | null;
  embedding_model: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryInput {
  scope: MemoryScope;
  project_id?: string | null;
  agent_id?: string | null;
  task_id?: string | null;
  conversation_id?: string | null;
  type: MemoryType;
  content: string;
  summary?: string;
  importance?: number;
  source?: MemorySource;
  created_by_user?: string | null;
  created_by_agent?: string | null;
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}
