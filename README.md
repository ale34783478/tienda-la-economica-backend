# Backend — Tienda La Económica (Inventario)

API REST en **Node.js + PostgreSQL (Neon)**, con SQLite opcional para trabajo local. Instala sus dependencias con `npm install`.

Gu?a de conexi?n, migraci?n y despliegue gratuito: [DEPLOY_NEON.md](DEPLOY_NEON.md).
Implementa los contratos del README del frontend: productos, inventario, movimientos, reportes y autenticación; además usuarios y configuración.

## Requisitos
- **Node.js 22.13 o superior** (`node -v` para comprobarlo). Descarga la versión LTS en https://nodejs.org

## Cómo ejecutarlo
```bash
cd backend
cp .env.example .env      # opcional: ajusta puerto, CORS y contraseñas
npm install
node server.js            # o: npm start   (npm run dev reinicia al guardar cambios)
```
Verás `API lista en http://localhost:8080`. Prueba: http://localhost:8080/api/health

Solo en modo SQLite (sin `DATABASE_URL`), la primera vez se crea `data/inventario.db` con los mismos productos de demostración del frontend y tres usuarios:

| Usuario      | Rol                | Contraseña inicial |
|--------------|--------------------|--------------------|
| `superadmin` | Superadministrador | `Economica2026!` (o la de `SEED_PASSWORD`) |
| `admin`      | Administrador      | igual              |
| `encargado`  | Encargado          | igual              |

**Cambia esas contraseñas** (`PUT /api/users/:id` con `{"password": "..."}`) antes de usarlo en serio.
Para reiniciar los datos de ejemplo, detén el servidor y borra la carpeta `data/`.

## Pruebas
```bash
npm test      # 11 pruebas automáticas de la API
```

## Autenticación
`POST /api/auth/login` devuelve un `token`. Envíalo en cada petición: `Authorization: Bearer <token>`.
Dura 8 horas; `POST /api/auth/logout` lo invalida. Tras 5 intentos fallidos se bloquea el login 15 minutos.

## Endpoints
Errores siempre con la forma `{ "message", "code", "details" }`.

| Método | Ruta | Descripción | Rol |
|---|---|---|---|
| GET | `/api/health` | Estado del servidor | público |
| POST | `/api/auth/login` | `{username, password}` → `{token, user}` | público |
| GET | `/api/auth/me` | Usuario de la sesión | cualquiera |
| POST | `/api/auth/logout` | Cierra la sesión | cualquiera |
| GET | `/api/products` | Filtros: `q`, `category`, `status` (`Disponible`, `Existencia baja`, `Agotado`), `active` | cualquiera |
| GET | `/api/products/:id` | Un producto | cualquiera |
| POST | `/api/products` | `{code,name,category,price,stock,minStock,description?}` | cualquiera |
| PUT | `/api/products/:id` | Edita (campos omitidos se conservan) | cualquiera |
| PATCH | `/api/products/:id/status` | `{active: true/false}` | cualquiera |
| GET | `/api/inventory` | Resumen + productos activos | cualquiera |
| GET | `/api/inventory/movements` | Filtros: `productId`, `type`, `from`, `to`, `limit`, `offset` | cualquiera |
| POST | `/api/inventory/movements` | `{productId, type: Entrada/Salida/Ajuste, quantity, reason}` | cualquiera |
| GET | `/api/reports/inventory` | Resumen, por categoría, stock bajo, agotados, últimos movimientos | cualquiera |
| GET / POST | `/api/users` | Listar / crear (sin `password` se genera una temporal) | Admin+ |
| PUT | `/api/users/:id` | Editar (`password` opcional) | Admin+ |
| PATCH | `/api/users/:id/status` | `{active}` | Admin+ |
| GET / PUT | `/api/settings` | Configuración del negocio (PUT: Admin+) | cualquiera / Admin+ |

Reglas de negocio (validadas en el servidor):
- No se permite una **salida** mayor a las existencias (`409 INSUFFICIENT_STOCK`); el stock nunca queda negativo.
- El **código** de producto es único sin importar mayúsculas (`409 CODE_DUPLICATE`).
- Un **Ajuste** acepta `targetStock` (nueva existencia); si no viene, `quantity` se toma como la nueva existencia.
- Cada cambio de stock queda en el historial (incluye las ediciones de stock y el stock inicial al crear un producto).
- El Superadministrador gestiona todas las cuentas; el Administrador solo las de rol Encargado. Nadie puede desactivarse a sí mismo.
- No se registran movimientos sobre productos inactivos.

## Variables de entorno (`.env`)
| Variable | Descripción |
|---|---|
| `PORT` | Puerto (por defecto 8080) |
| `JWT_SECRET` | **Obligatoria en producción** (mín. 16 caracteres). Sin ella, las sesiones se pierden al reiniciar |
| `DB_PATH` | Archivo SQLite (por defecto `data/inventario.db`) |
| `CORS_ORIGIN` | Orígenes permitidos separados por coma, ej. `http://localhost:5173,https://tu-app.vercel.app` |
| `SEED_PASSWORD` | Contraseña inicial de los usuarios de ejemplo |

## Conectar con el frontend
En el `.env` del frontend: `VITE_DATA_MODE=api` y `VITE_API_BASE_URL=http://localhost:8080`.
Nota: por ahora el frontend todavía usa `localStorage` (`Store.jsx`) y no llama a `src/services/api.js`; ese cambio es el siguiente paso.

## Despliegue

Con `DATABASE_URL` el backend usa PostgreSQL en Neon y no necesita disco persistente.
Ver [DEPLOY_NEON.md](DEPLOY_NEON.md). SQLite solo necesita disco persistente si se elige
mantener ese modo en un servidor. No publicar la base local ni las credenciales en GitHub.
