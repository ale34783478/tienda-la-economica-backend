import '../src/env.js';
import { openPostgres, migratePostgres } from '../src/database.js';
if (!process.env.DATABASE_URL_UNPOOLED) throw Error('Define DATABASE_URL_UNPOOLED para las migraciones.');
const db = openPostgres(process.env.DATABASE_URL_UNPOOLED);
try {
  await migratePostgres(db);
  console.log('PostgreSQL: esquema de inventario preparado.');
} finally { await db.close(); }
