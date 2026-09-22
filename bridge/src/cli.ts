#!/usr/bin/env node
/**
 * acc-bridge — AI Command Center local Agent Bridge
 *
 *   acc-bridge run  [--url URL] [--token-file FILE] [--workspace DIR] [--runner claude-code|codex|command|echo]
 *   acc-bridge mcp  --url URL --token-file FILE [--task-id ID]   (started by the agent CLI, stdio)
 *   acc-bridge check                                            (validate config + runner)
 */
import { loadConfig } from './config.js';
import { BridgeWorker, makeRunner, BRIDGE_VERSION } from './worker.js';
import { runMcpServer } from './mcp-server.js';
import { log, setLogLevel } from './log.js';

async function main() {
  const [cmd = 'run', ...rest] = process.argv.slice(2);
  if (cmd === 'mcp') {
    await runMcpServer(rest);
    return;
  }
  if (cmd === '--version' || cmd === 'version') {
    console.log(BRIDGE_VERSION);
    return;
  }
  if (cmd === 'help' || cmd === '--help') {
    console.log('Usage: acc-bridge run|check|mcp [options]. See docs/AGENTS.md');
    return;
  }
  const cfg = loadConfig(rest);
  setLogLevel(cfg.logLevel);
  if (cmd === 'check') {
    const problem = await makeRunner(cfg).check();
    if (problem) {
      log.error(problem);
      process.exit(1);
    }
    log.info(`Config OK · runner ${cfg.runner} · workspace ${cfg.workspace} · orchestrator ${cfg.url}`);
    return;
  }
  if (cmd !== 'run') throw new Error(`Unknown command ${cmd}`);
  await new BridgeWorker(cfg).start();
}

main().catch((e) => {
  log.error(String((e as Error).message ?? e));
  process.exit(1);
});
