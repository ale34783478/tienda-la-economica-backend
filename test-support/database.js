import '../src/env.js';
import { randomBytes } from 'node:crypto';
import { openDb, seedIfEmpty } from '../src/db.js';
import { openPostgres, migratePostgres } from '../src/database.js';
import { snapshotSqlite, importSnapshot } from '../src/import-sqlite.js';

export async function testDatabase(password) {
  const sqlite = openDb(':memory:');
  seedIfEmpty(sqlite, password);
  if (process.env.TEST_POSTGRES !== '1') return sqlite;
  if (!process.env.DATABASE_URL_UNPOOLED) throw Error('Falta DATABASE_URL_UNPOOLED para las pruebas PostgreSQL.');
  const schema = `test_inventory_${randomBytes(8).toString('hex')}`;
  const admin = openPostgres(process.env.DATABASE_URL_UNPOOLED);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL_UNPOOLED);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = openPostgres(url.toString());
  const close = db.close;
  db.close = async () => {
    await close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  };
  try {
    await migratePostgres(db);
    await importSnapshot(db, snapshotSqlite(sqlite));
    return db;
  } catch (error) { await db.close(); throw error; }
  finally { sqlite.close(); }
}
