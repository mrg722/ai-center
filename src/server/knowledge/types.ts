export type KnowledgeScope = 'global' | 'project';

export interface KnowledgeDocumentRow {
  id: string;
  scope: KnowledgeScope;
  project_id: string | null;
  title: string;
  source: string;
  path: string | null;
  category: string;
  version: string;
  checksum: string | null;
  metadata: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  embedding: number[] | null;
  embedding_model: string | null;
  created_at: string;
}

export interface CreateKnowledgeDocumentInput {
  scope?: KnowledgeScope;
  project_id?: string | null;
  title: string;
  content: string; // full text; chunked on insert
  source?: string;
  path?: string | null;
  category?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}
