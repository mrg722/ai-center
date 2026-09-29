export type EngagementTargetType = 'repo' | 'url' | 'host';
export type EngagementStatus = 'draft' | 'active' | 'expired' | 'revoked';
export type ScanMode = 'quick' | 'standard' | 'deep';
export type SecurityRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type FindingStatus = 'open' | 'confirmed' | 'false_positive' | 'fixed';

export interface EngagementRow {
  id: string;
  project_id: string;
  target: string;
  target_type: EngagementTargetType;
  scope_notes: string;
  authorization_evidence: string;
  authorized_by: string;
  status: EngagementStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecurityRunRow {
  id: string;
  project_id: string;
  engagement_id: string;
  target: string;
  scan_mode: ScanMode;
  status: SecurityRunStatus;
  bridge_run_name: string | null;
  summary: string;
  error: string;
  requested_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FindingRow {
  id: string;
  project_id: string;
  security_run_id: string;
  title: string;
  severity: FindingSeverity;
  description: string;
  evidence: string;
  location: string;
  status: FindingStatus;
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateEngagementInput {
  project_id: string;
  target: string;
  target_type: EngagementTargetType;
  scope_notes?: string;
  authorization_evidence: string;
  authorized_by: string;
  starts_at?: string | null;
  ends_at?: string | null;
  created_by: string;
}

export interface CreateSecurityRunInput {
  project_id: string;
  engagement_id: string;
  scan_mode: ScanMode;
  requested_by: string;
}
