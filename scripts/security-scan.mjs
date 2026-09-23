#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const suspicious = [
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'Slack bot token', re: /\bxoxb-[0-9A-Za-z-]{20,}\b/g },
  { name: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Postgres connection string with credentials', re: /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@[^\s]+/gi },
];

const findings = [];
for (const file of tracked) {
  if (file === 'scripts/security-scan.mjs') continue;
  let text;
  try { text = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); }
  catch { continue; }
  for (const rule of suspicious) {
    if (rule.re.test(text)) findings.push(`${rule.name}: ${file}`);
    rule.re.lastIndex = 0;
  }
}
if (findings.length) {
  console.error('Potential hardcoded secrets detected:');
  for (const f of findings) console.error(` - ${f}`);
  process.exit(1);
}
console.log(`Security scan passed: ${tracked.length} tracked files checked.`);
