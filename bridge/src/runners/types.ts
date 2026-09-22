import type { ActionResult, AgentAction, AgentIdentity, InboxItem } from '../../../src/shared/protocol';

export interface RunInput {
  item: InboxItem;
  agent: AgentIdentity;
  workspace: string;
  /** Path to a 0600 MCP config file for this run (Claude Code format), if any. */
  mcpConfigPath: string | null;
  /** Provider conversation/session identifier persisted by ACC, when supported by the runtime. */
  providerSessionId?: string | null;
  /** Arguments to start the ACC MCP server (for runners that configure MCP by args). */
  mcpServer: { command: string; args: string[] } | null;
  signal: AbortSignal;
  maxRunSeconds: number;
  extraArgs: string[];
  bin?: string;
  command?: string[];
  onActivity: (kind: 'log' | 'thinking' | 'tool' | 'output', text: string) => void;
  onStatus: (status: 'WORKING' | 'THINKING' | 'REVIEWING') => void;
  /** Direct access to the orchestrator agent API (used by the echo test runner). */
  api: (action: AgentAction) => Promise<ActionResult>;
}

export interface RunOutput {
  text: string;
  tokens_in?: number;
  tokens_out?: number;
  /** Provider conversation/session identifier returned by the runtime, when available. */
  providerSessionId?: string;
}

export interface Runner {
  name: string;
  /** Tool names this runner exposes (reported to the orchestrator for the UI). */
  tools(): string[];
  /** Verifies the runner binary exists; returns an error message if not. */
  check(): Promise<string | null>;
  run(input: RunInput): Promise<RunOutput>;
}
