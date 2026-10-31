import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import './env.js';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

let jwtSecret = env.JWT_SECRET;
let ephemeralSecret = false;
if (!jwtSecret || jwtSecret.length < 16) {
  if (isProd) {
    console.error('ERROR: define JWT_SECRET (mínimo 16 caracteres) en producción.');
    process.exit(1);
  }
  jwtSecret = randomBytes(32).toString('hex');
  ephemeralSecret = true; // las sesiones se cierran cada vez que se reinicia el servidor
}

export const config = {
  port: Number(env.PORT) || 8080,
  databaseUrl: env.DATABASE_URL || '',
  dbPath: env.DB_PATH || fileURLToPath(new URL('../data/inventario.db', import.meta.url)),
  corsOrigins: (env.CORS_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean),
  jwtSecret,
  ephemeralSecret,
  tokenTtlSeconds: 8 * 60 * 60,
  seedPassword: env.SEED_PASSWORD || '',
};
