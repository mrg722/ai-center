import 'server-only';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { env } from '../env';

/**
 * Tiny database abstraction. Two drivers, same SQL:
 *  - `pg`     → any PostgreSQL (Supabase in production) via DATABASE_URL
 *  - `pglite` → embedded Postgres (WASM) for zero-setup local development
 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  driver: 'pg' | 'pglite';
}

type PgPool = import('pg').Pool;
type PgClient = import('pg').PoolClient;

class PgDb implements Db {
  driver = 'pg' as const;
  constructor(private pool: PgPool) {}
  async query<T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pool.query(text, params as unknown[]);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const out = await fn(new PgClientDb(client));
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

class PgClientDb implements Db {
  driver = 'pg' as const;
  constructor(private client: PgClient) {}
  async query<T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.client.query(text, params as unknown[]);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return fn(this); // already inside a transaction
  }
}

type PGliteT = import('@electric-sql/pglite').PGlite;
type PGliteTx = import('@electric-sql/pglite').Transaction;

class PgliteDb implements Db {
  driver = 'pglite' as const;
  constructor(private pg: PGliteT | PGliteTx) {}
  async query<T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pg.query<T>(text, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if ('transaction' in this.pg) {
      return (this.pg as PGliteT).transaction((tx) => fn(new PgliteDb(tx)));
    }
    return fn(this);
  }
  async exec(sql: string) {
    await (this.pg as PGliteT).exec(sql);
  }
}

const g = globalThis as unknown as { __accDb?: Promise<Db> };

async function create(): Promise<Db> {
  const url = env.databaseUrl;
  let db: Db;
  if (url) {
    const { Pool, types } = await import('pg');
    types.setTypeParser(20, (v: string) => Number(v)); // int8 → number (ids / counts fit easily)
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 20_000,
      ssl: /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    db = new PgDb(pool);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = env.pgliteDir;
    if (dir !== 'memory') await mkdir(dirname(dir), { recursive: true });
    const pg = dir === 'memory' ? new PGlite() : new PGlite(dir);
    await pg.waitReady;
    db = new PgliteDb(pg);
  }
  const { migrate } = await import('./migrate');
  await migrate(db);
  return db;
}

export function getDb(): Promise<Db> {
  if (!g.__accDb) {
    g.__accDb = create().catch((e) => {
      g.__accDb = undefined;
      throw e;
    });
  }
  return g.__accDb;
}

/** Test helper: replace the singleton. */
export function __setDb(db: Promise<Db> | undefined) {
  g.__accDb = db;
}
