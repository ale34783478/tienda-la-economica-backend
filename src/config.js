import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Carga backend/.env si existe (Node 22 trae soporte nativo).
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* sin .env: se usan valores por defecto */ }

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
  dbPath: env.DB_PATH || fileURLToPath(new URL('../data/inventario.db', import.meta.url)),
  corsOrigins: (env.CORS_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean),
  jwtSecret,
  ephemeralSecret,
  tokenTtlSeconds: 8 * 60 * 60,
  seedPassword: env.SEED_PASSWORD || '',
};
