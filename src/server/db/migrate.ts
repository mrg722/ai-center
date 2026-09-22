import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './index';

/**
 * Applies supabase/migrations/*.sql in lexical order, once each, tracked in
 * `_acc_migrations`. Safe to run concurrently (advisory lock on Postgres).
 * Disable automatic runs with ACC_AUTO_MIGRATE=false and use `npm run db:migrate`
 * or the Supabase CLI instead.
 */
export async function migrate(db: Db, dir = join(process.cwd(), 'supabase', 'migrations')): Promise<string[]> {
  if (process.env.ACC_AUTO_MIGRATE === 'false') return [];
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  await db.query(`create table if not exists _acc_migrations (name text primary key, applied_at timestamptz not null default now())`);
  if (db.driver === 'pg') await db.query('select pg_advisory_lock(424242)');
  try {
    const done = new Set((await db.query<{ name: string }>('select name from _acc_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await execScript(db, sql);
      await db.query('insert into _acc_migrations (name) values ($1) on conflict do nothing', [f]);
      applied.push(f);
    }
  } finally {
    if (db.driver === 'pg') await db.query('select pg_advisory_unlock(424242)');
  }
  return applied;
}

async function execScript(db: Db, sql: string) {
  const anyDb = db as unknown as { exec?: (s: string) => Promise<void> };
  if (typeof anyDb.exec === 'function') {
    await anyDb.exec(sql); // PGlite: multi-statement exec
  } else {
    await db.query(sql); // pg: simple query protocol accepts multiple statements without params
  }
}
