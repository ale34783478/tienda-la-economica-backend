import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Each transaction keeps its own connection across awaited queries.
export function openPostgres(connectionString) {
  const url = new URL(connectionString);
  // Keep certificate verification explicit for Neon, including future pg versions.
  if (url.hostname.endsWith('.neon.tech')) url.searchParams.set('sslmode', 'verify-full');
  const context = new AsyncLocalStorage();
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 15000,
    types: { getTypeParser: (oid, format) => [20, 1700].includes(oid) ? Number : pg.types.getTypeParser(oid, format) } });
  pool.on('error', (error) => console.error('PostgreSQL pool:', error.code || error.name));
  const query = (sql, values) => (context.getStore() || pool).query(sql, values);
  return {
    dialect: 'postgres',
    get lockClause() { return context.getStore() ? ' FOR UPDATE' : ''; },
    query,
    prepare(sql) {
      let index = 0;
      // App queries use ? only as parameter placeholders, never inside SQL literals.
      const text = sql.replace(/\?/g, () => `$${++index}`);
      return {
        get: async (...values) => (await query(text, values)).rows[0],
        all: async (...values) => (await query(text, values)).rows,
        run: async (...values) => ({ changes: (await query(text, values)).rowCount }),
      };
    },
    async transaction(fn) {
      if (context.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await context.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

export async function migratePostgres(db) {
  const sql = await readFile(new URL('../migrations/001-inventory.sql', import.meta.url), 'utf8');
  await db.transaction(async () => {
    await db.query('SELECT pg_advisory_xact_lock(78120401)');
    await db.query(sql);
  });
}

// Preserve local SQLite support; serialize writes now that handlers are async.
const wrappers = new WeakMap();
export function wrapSqlite(raw) {
  if (wrappers.has(raw)) return wrappers.get(raw);
  const context = new AsyncLocalStorage();
  let pending = Promise.resolve();
  const db = {
    dialect: 'sqlite', lockClause: '',
    prepare: (sql) => raw.prepare(sql),
    close: () => raw.close(),
    transaction(fn) {
      if (context.getStore()) return fn();
      const work = pending.then(() => context.run(true, async () => {
        raw.exec('BEGIN IMMEDIATE');
        try { const result = await fn(); raw.exec('COMMIT'); return result; }
        catch (error) { raw.exec('ROLLBACK'); throw error; }
      }));
      pending = work.catch(() => {});
      return work;
    },
  };
  wrappers.set(raw, db);
  return db;
}
