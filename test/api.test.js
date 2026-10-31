import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seedIfEmpty } from '../src/db.js';
import { createApp } from '../src/app.js';

let server, base, db;
const config = { port: 0, corsOrigins: ['http://localhost:5173'], jwtSecret: 'x'.repeat(32), tokenTtlSeconds: 3600 };
const PASS = 'ClavePrueba123';

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
}
const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PASS } })).data.token;

before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db, PASS);
  server = createApp({ db, config });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

test('health no requiere sesión', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'ok');
});

test('rutas protegidas devuelven 401 sin token', async () => {
  assert.equal((await call('GET', '/api/products')).status, 401);
  assert.equal((await call('GET', '/api/products', { token: 'basura' })).status, 401);
});

test('login: credenciales incorrectas y correctas', async () => {
  const bad = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'mala' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.code, 'INVALID_CREDENTIALS');
  const ok = await call('POST', '/api/auth/login', { body: { username: 'ADMIN', password: PASS } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'Administrador');
  assert.equal(ok.data.user.password_hash, undefined);
  const me = await call('GET', '/api/auth/me', { token: ok.data.token });
  assert.equal(me.data.username, 'admin');
});

test('logout invalida el token', async () => {
  const token = await login('encargado');
  assert.equal((await call('POST', '/api/auth/logout', { token })).status, 204);
  assert.equal((await call('GET', '/api/auth/me', { token })).status, 401);
});

test('bloqueo tras demasiados intentos fallidos', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/api/auth/login', { body: { username: 'fantasma', password: 'incorrecta' } });
  assert.equal(last.status, 429);
});

test('productos: listar, filtrar y consultar', async () => {
  const token = await login('admin');
  const all = await call('GET', '/api/products', { token });
  assert.equal(all.data.length, 22);
  const out = await call('GET', '/api/products?status=Agotado', { token });
  assert.ok(out.data.every((p) => p.stock === 0));
  const q = await call('GET', '/api/products?q=arroz', { token });
  assert.equal(q.data[0].code, 'AB-101');
  assert.equal((await call('GET', '/api/products/no-existe', { token })).status, 404);
});

test('productos: crear, duplicado, validación, editar y desactivar', async () => {
  const token = await login('encargado');
  const bad = await call('POST', '/api/products', { token, body: { code: 'X', name: '', price: -1 } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.details.price);

  const created = await call('POST', '/api/products', { token, body: { code: 'NU-001', name: 'Producto nuevo', category: 'Hogar', price: '12.345', stock: 5, minStock: 2 } });
  assert.equal(created.status, 201);
  assert.equal(created.data.price, 12.35);
  assert.equal(created.data.status, 'Disponible');

  const dup = await call('POST', '/api/products', { token, body: { code: 'nu-001', name: 'Otro', category: 'Hogar', price: 1, stock: 0, minStock: 0 } });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.code, 'CODE_DUPLICATE');

  const id = created.data.id;
  const put = await call('PUT', `/api/products/${id}`, { token, body: { name: 'Producto renombrado', stock: 1 } });
  assert.equal(put.data.name, 'Producto renombrado');
  assert.equal(put.data.status, 'Existencia baja');
  const hist = await call('GET', `/api/inventory/movements?productId=${id}`, { token });
  assert.deepEqual(hist.data.map((m) => m.type).sort(), ['Ajuste', 'Entrada']);

  const off = await call('PATCH', `/api/products/${id}/status`, { token, body: { active: false } });
  assert.equal(off.data.active, false);
  const mv = await call('POST', '/api/inventory/movements', { token, body: { productId: id, type: 'Entrada', quantity: 1 } });
  assert.equal(mv.status, 409);
  assert.equal(mv.data.code, 'PRODUCT_INACTIVE');
});

test('movimientos: entrada, salida, exceso, ajuste y validaciones', async () => {
  const token = await login('admin');
  const stock = async () => (await call('GET', '/api/products/p1', { token })).data.stock; // arranca en 34
  assert.equal(await stock(), 34);

  const ent = await call('POST', '/api/inventory/movements', { token, body: { productId: 'p1', type: 'Entrada', quantity: 6, reason: 'Compra' } });
  assert.equal(ent.status, 201);
  assert.equal(ent.data.stockBefore, 34);
  assert.equal(ent.data.product.stock, 40);
  assert.equal(ent.data.user, 'Gabriel Velasquez');

  const sal = await call('POST', '/api/inventory/movements', { token, body: { productId: 'p1', type: 'Salida', quantity: 10 } });
  assert.equal(sal.status, 201);
  assert.equal(await stock(), 30);

  const exceso = await call('POST', '/api/inventory/movements', { token, body: { productId: 'p1', type: 'Salida', quantity: 31 } });
  assert.equal(exceso.status, 409);
  assert.equal(exceso.data.code, 'INSUFFICIENT_STOCK');
  assert.equal(await stock(), 30, 'una salida rechazada no debe cambiar el stock');

  const aj = await call('POST', '/api/inventory/movements', { token, body: { productId: 'p1', type: 'Ajuste', targetStock: 25 } });
  assert.equal(aj.data.quantity, 5);
  assert.equal(await stock(), 25);
  const ajQty = await call('POST', '/api/inventory/movements', { token, body: { productId: 'p1', type: 'Ajuste', quantity: 20 } });
  assert.equal(ajQty.status, 201);
  assert.equal(await stock(), 20);

  assert.equal((await call('POST', '/api/inventory/movements', { token, body: { productId: 'p1', type: 'Salida', quantity: 0 } })).status, 400);
  assert.equal((await call('POST', '/api/inventory/movements', { token, body: { productId: 'p1', type: 'Otro', quantity: 1 } })).status, 400);
  assert.equal((await call('POST', '/api/inventory/movements', { token, body: { productId: 'nope', type: 'Entrada', quantity: 1 } })).status, 404);
});

test('inventario y reporte coinciden con los productos', async () => {
  const token = await login('admin');
  const inv = await call('GET', '/api/inventory', { token });
  const rep = await call('GET', '/api/reports/inventory', { token });
  assert.equal(inv.data.summary.totalUnits, inv.data.items.reduce((a, p) => a + p.stock, 0));
  assert.equal(rep.data.summary.outOfStock, rep.data.outOfStock.length);
  assert.equal(rep.data.summary.lowStock, rep.data.lowStock.length);
  assert.equal(rep.data.businessName, 'Tienda La Económica');
  assert.ok(rep.data.byCategory.length > 0);
});

test('usuarios: reglas por rol', async () => {
  const enc = await login('encargado');
  const adm = await login('admin');
  const sup = await login('superadmin');

  // Administrador solo edita Encargados, incluida la restricción sobre su propia cuenta.
  assert.equal((await call('PUT', '/api/users/u2', { token: adm, body: { name: 'Cambio propio' } })).status, 403);
  assert.equal((await call('PUT', '/api/users/u1', { token: adm, body: { name: 'Cambio ajeno' } })).status, 403);
  assert.equal((await call('PUT', '/api/users/u3', { token: adm, body: { name: 'Encargado editado' } })).status, 200);
  assert.equal((await call('PUT', '/api/users/u3', { token: adm, body: { role: 'Administrador' } })).status, 403);
  for (const id of ['u1', 'u2', 'u3']) {
    assert.equal((await call('PUT', `/api/users/${id}`, { token: sup, body: {} })).status, 200);
  }

  assert.equal((await call('GET', '/api/users', { token: enc })).status, 403);
  assert.equal((await call('PUT', '/api/settings', { token: enc, body: { currency: 'USD' } })).status, 403);

  // Administrador crea Encargado (contraseña temporal) pero no otro Administrador
  const nuevo = await call('POST', '/api/users', { token: adm, body: { name: 'Ana Pérez', username: 'ana', role: 'Encargado' } });
  assert.equal(nuevo.status, 201);
  assert.ok(nuevo.data.temporaryPassword);
  const loginAna = await call('POST', '/api/auth/login', { body: { username: 'ana', password: nuevo.data.temporaryPassword } });
  assert.equal(loginAna.status, 200);
  assert.equal((await call('POST', '/api/users', { token: adm, body: { name: 'Otro Admin', username: 'otroadmin', role: 'Administrador' } })).status, 403);
  assert.equal((await call('POST', '/api/users', { token: adm, body: { name: 'Ana Dos', username: 'ANA', role: 'Encargado' } })).status, 409);

  // Administrador no puede tocar al Superadministrador ni desactivarse a sí mismo
  assert.equal((await call('PATCH', '/api/users/u1/status', { token: adm, body: { active: false } })).status, 403);
  assert.equal((await call('PATCH', '/api/users/u2/status', { token: adm, body: { active: false } })).status, 403);

  // Superadministrador desactiva a Ana y ella ya no puede entrar
  assert.equal((await call('PATCH', `/api/users/${nuevo.data.id}/status`, { token: sup, body: { active: false } })).data.active, false);
  assert.equal((await call('GET', '/api/auth/me', { token: loginAna.data.token })).status, 401);

  const st = await call('PUT', '/api/settings', { token: adm, body: { currency: 'usd', defaultMinStock: 12 } });
  assert.equal(st.data.currency, 'USD');
  assert.equal(st.data.defaultMinStock, 12);
});

test('errores: JSON inválido, 404, 405 y CORS', async () => {
  const token = await login('admin');
  const res = await fetch(base + '/api/products', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{roto' });
  assert.equal(res.status, 400);
  assert.equal((await call('GET', '/api/nada', { token })).status, 404);
  assert.equal((await call('DELETE', '/api/products', { token })).status, 405);
  const pre = await fetch(base + '/api/products', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const ajeno = await fetch(base + '/api/health', { headers: { Origin: 'http://malo.com' } });
  assert.equal(ajeno.headers.get('access-control-allow-origin'), null);
});
