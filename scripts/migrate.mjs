#!/usr/bin/env node
// Applies supabase/migrations/*.sql to DATABASE_URL (tracked in _acc_migrations).
// Usage: DATABASE_URL=postgres://… npm run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (PGlite migrates itself automatically on first use).');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined });
await client.connect();
await client.query('create table if not exists _acc_migrations (name text primary key, applied_at timestamptz not null default now())');
const done = new Set((await client.query('select name from _acc_migrations')).rows.map((r) => r.name));
for (const f of readdirSync('supabase/migrations').filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
  if (done.has(f)) continue;
  await client.query(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  await client.query('insert into _acc_migrations (name) values ($1)', [f]);
  console.log('applied', f);
}
await client.end();
console.log('migrations up to date');
