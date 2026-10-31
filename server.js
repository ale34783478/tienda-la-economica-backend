// Punto de entrada: node server.js
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Este backend necesita Node.js 22.13 o superior (tienes ${process.versions.node}). Descarga la versión LTS en https://nodejs.org`);
  process.exit(1);
}

const { config } = await import('./src/config.js');
const { openDb, seedIfEmpty } = await import('./src/db.js');
const { createApp } = await import('./src/app.js');

const db = openDb(config.dbPath);
const seeded = seedIfEmpty(db, config.seedPassword);
if (seeded) {
  console.log('Base de datos nueva: se crearon los usuarios superadmin, admin y encargado.');
  if (seeded.usedDefault) console.log(`Contraseña inicial: ${seeded.password}  (cámbiala o define SEED_PASSWORD en .env)`);
}
if (config.ephemeralSecret) console.warn('Aviso: JWT_SECRET no está definido; se usa uno temporal y las sesiones se pierden al reiniciar.');

const server = createApp({ db, config });
server.listen(config.port, () => console.log(`API lista en http://localhost:${config.port}  (prueba: /api/health)`));

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
