import '../src/env.js';
import { DatabaseSync, backup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openPostgres } from '../src/database.js';
import { snapshotSqlite, importSnapshot } from '../src/import-sqlite.js';

if (!process.env.DATABASE_URL_UNPOOLED) throw Error('Define DATABASE_URL_UNPOOLED.');
const sourcePath = process.argv[2] || fileURLToPath(new URL('../data/inventario.db', import.meta.url));
const source = new DatabaseSync(sourcePath, { readOnly: true });
const db = openPostgres(process.env.DATABASE_URL_UNPOOLED);
try {
  const backupPath = `${sourcePath}.backup-${Date.now()}.db`;
  await backup(source, backupPath);
  console.log('Copia de seguridad SQLite creada:', backupPath);
  const counts = await importSnapshot(db, snapshotSqlite(source));
  console.log('Importación verificada (incluye contraseñas y permisos):', JSON.stringify(counts));
} finally { source.close(); await db.close(); }
