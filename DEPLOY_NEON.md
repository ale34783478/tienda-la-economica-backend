# PostgreSQL en Neon y backend Node

El frontend conserva sus pantallas y contratos REST. El backend usa `pg` con un pool
de conexiones cuando existe `DATABASE_URL`; sin esa variable sigue usando SQLite.
Las transacciones utilizan una sola conexión y bloquean el producto durante los
movimientos para evitar existencias incorrectas con solicitudes simultáneas.

## Desarrollo en este proyecto

Desde la raíz:

```powershell
npm.cmd install
npm.cmd install --prefix backend
npm.cmd run server
# Otra terminal:
npm.cmd run dev
```

El backend lee las variables del proceso, `backend/.env`, `backend/.env.local`,
`.env` y `.env.local` de la raíz, en ese orden de prioridad. Neon CLI escribe
`DATABASE_URL` (pool) y `DATABASE_URL_UNPOOLED` (migraciones) en la raíz.
Las credenciales de base de datos nunca llevan prefijo `VITE_`.

## Esquema e importación inicial

Sobre una rama de desarrollo, antes de producción:

```powershell
neon.cmd checkout inventory-setup-test --create
npm.cmd run db:migrate --prefix backend
npm.cmd run db:import-sqlite --prefix backend
```

La importación lee SQLite sin modificarlo, crea una copia de seguridad junto al
archivo original y copia usuarios (incluidos hashes de contraseñas), productos,
movimientos, configuración y tokens revocados dentro de una transacción. Compara
todos los registros antes de confirmar. Si alguna tabla de destino contiene datos,
se detiene sin reemplazarlos. No ejecutar esta importación en cada despliegue.

Tras validar, seleccionar `production`, ejecutar la migración y hacer una sola
importación. Detener las escrituras del backend anterior durante el traslado final;
los cambios posteriores de SQLite no se sincronizan automáticamente con Neon.

## Pruebas

```powershell
# SQLite en memoria:
npm.cmd run test:backend
# PostgreSQL: cada suite usa un esquema temporal y lo elimina al terminar.
$env:TEST_POSTGRES='1'
npm.cmd run test:backend
Remove-Item Env:TEST_POSTGRES
# Navegador real + PostgreSQL (Edge en Windows o BROWSER_PATH):
node scripts/verify-neon.mjs
npm.cmd run build
```

En el repositorio que solo contiene el backend se usa `npm test`. Las pruebas
del cliente frontend se omiten cuando no existe `../src/services/inventory.js`.

## Publicar el backend separado en Render

Actualizar el repositorio GitHub del backend con `src/`, `scripts/`, `migrations/`,
`test/`, `test-support/`, `server.js`, `package.json`, `package-lock.json` y documentación.
No subir `.env*` reales, `data/` ni `node_modules/`.

Crear un Web Service conectado al repositorio existente:

- Root Directory: vacío (el repositorio tiene `server.js` en la raíz).
- Build Command: `npm ci`.
- Start Command: `npm start`.
- Instance Type: Free.
- Health Check Path: `/api/health`.
- Variables: `NODE_VERSION=24`, `NODE_ENV=production`, `DATABASE_URL` de producción,
  `JWT_SECRET` aleatorio (al menos 32 caracteres) y `CORS_ORIGIN` con el origen exacto
  del frontend Vercel, sin barra final. Render suministra `PORT`.

El arranque no inserta usuarios de demostración en PostgreSQL ni sobrescribe datos.
El esquema debe estar preparado antes del primer arranque. Las futuras migraciones
se ejecutan expresamente con la URL directa, no con la conexión del pool.
El plan gratuito puede suspender el backend por inactividad; los datos están en Neon.

## Actualizar el frontend existente en Vercel

- Framework: Vite; build: `npm run build`; salida: `dist`.
- `VITE_DATA_MODE=api`.
- `VITE_API_BASE_URL=https://URL-PUBLICA-DEL-BACKEND` (sin `/api` final).
- Volver a desplegar el proyecto existente después de cambiar estas variables.

No poner `DATABASE_URL` ni `JWT_SECRET` en variables `VITE_*` o en el navegador.
Comprobar `/api/health`, inicio de sesión, creación/edición y permisos en la URL pública.
`neon deploy` configura la base de datos; no publica este servidor Node ni el frontend.
