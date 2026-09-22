#!/usr/bin/env node
// Creates .env.local with random secrets (never overwrites an existing file).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env.local')) {
  console.log('.env.local already exists — not touching it.');
  process.exit(0);
}
const rnd = (n) => randomBytes(n).toString('base64url');
const setup = rnd(18);
const text = readFileSync('.env.example', 'utf8')
  .replace(/^SESSION_SECRET=$/m, `SESSION_SECRET=${rnd(48)}`)
  .replace(/^SETUP_TOKEN=$/m, `SETUP_TOKEN=${setup}`)
  .replace(/^CRON_SECRET=$/m, `CRON_SECRET=${rnd(32)}`);
writeFileSync('.env.local', text, { mode: 0o600 });
console.log('Created .env.local');
console.log(`Your one-time SETUP_TOKEN (needed at /setup): ${setup}`);
