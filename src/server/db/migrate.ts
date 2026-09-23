import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './index';

/**
 * Applies supabase/migrations/*.sql in lexical order, once each.
 *
 * IMPORTANT: production uses Supabase's transaction pooler (port 6543), so
 * session-level advisory locks are unsafe: the next statement may be routed
 * to a different backend connection and the lock can be left behind. Keep
 * the entire migration sequence inside one DB transaction and use the
 * transaction-scoped advisory lock.
 */
export async function migrate(db: Db, dir = join(process.cwd(), 'supabase', 'migrations')): Promise<string[]> {
  if (process.env.ACC_AUTO_MIGRATE === 'false') return [];

  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

  return db.tx(async (tx) => {
    const applied: string[] = [];

    await tx.query(
      'create table if not exists _acc_migrations (name text primary key, applied_at timestamptz not null default now())',
    );

    if (tx.driver === 'pg') {
      await tx.query('select pg_advisory_xact_lock(424242)');
    }

    const done = new Set(
      (await tx.query<{ name: string }>('select name from _acc_migrations')).rows.map((r) => r.name),
    );

    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await execScript(tx, sql);
      await tx.query('insert into _acc_migrations (name) values ($1) on conflict do nothing', [f]);
      applied.push(f);
    }

    return applied;
  });
}

async function execScript(db: Db, sql: string) {
  const anyDb = db as unknown as { exec?: (s: string) => Promise<void> };
  if (typeof anyDb.exec === 'function') {
    await anyDb.exec(sql);
  } else {
    await db.query(sql);
  }
}
