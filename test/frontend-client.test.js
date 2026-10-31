// Prueba de integración: usa las MISMAS funciones que el frontend (src/services) contra el backend real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { openDb, seedIfEmpty } from '../src/db.js';
import { createApp } from '../src/app.js';

const clientPath = new URL('../../src/services/inventory.js', import.meta.url);
const hasClient = existsSync(clientPath);
const PASS = 'ClavePrueba123';
let server, db, inv, api;
const realFetch = globalThis.fetch;

before(async () => {
  if (!hasClient) return;
  db = openDb(':memory:');
  seedIfEmpty(db, PASS);
  server = createApp({ db, config: { corsOrigins: ['*'], jwtSecret: 'y'.repeat(32), tokenTtlSeconds: 3600 } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  // En el navegador las rutas relativas se resuelven solas; en Node se les antepone el servidor de prueba.
  globalThis.fetch = (url, opts) => realFetch(String(url).startsWith('/') ? base + url : url, opts);
  api = await import(new URL('../../src/services/api.js', import.meta.url));
  inv = await import(clientPath);
});
after(() => { globalThis.fetch = realFetch; server?.close(); db?.close(); });

const skip = { skip: !hasClient && 'se ejecuta dentro del proyecto completo (necesita src/services)' };

test('flujo completo del frontend: login, datos, producto, movimientos', skip, async () => {
  const user = await inv.login('admin', PASS);
  assert.equal(user.role, 'Administrador');
  assert.ok(api.getToken());

  const data = await inv.loadAll(user);
  assert.equal(data.products.length, 22);
  assert.ok(data.movements.length >= 1);
  assert.equal(data.settings.businessName, 'Tienda La Económica');
  assert.ok(data.users.length >= 3);

  // El formulario de productos entrega números y la categoría ya recortada
  const nuevo = await inv.saveProduct({ code: 'ZZ-900', name: 'Producto de prueba', category: 'Hogar', price: 9.99, stock: 10, minStock: 3, description: '' });
  assert.equal(nuevo.stock, 10);
  const editado = await inv.saveProduct({ ...nuevo, name: 'Producto editado', stock: 12 });
  assert.equal(editado.stock, 12);
  await assert.rejects(inv.saveProduct({ code: 'zz-900', name: 'Repetido', category: 'Hogar', price: 1, stock: 0, minStock: 0 }), (e) => e.status === 409 && /ya está registrado/.test(e.message));
  await assert.rejects(inv.saveProduct({ code: 'A', name: '', category: '', price: -5, stock: 0, minStock: 0 }), (e) => e.status === 400 && Boolean(e.details.price) && Boolean(e.details.code));

  await inv.registerMovement({ productId: nuevo.id, type: 'Salida', quantity: 5, reason: 'Venta' });
  await assert.rejects(inv.registerMovement({ productId: nuevo.id, type: 'Salida', quantity: 99, reason: 'x' }), (e) => e.code === 'INSUFFICIENT_STOCK' && /supera las existencias/.test(e.message));
  // Ajuste: la pantalla manda la existencia final en "quantity" (aquí 0)
  const aj = await inv.registerMovement({ productId: nuevo.id, type: 'Ajuste', quantity: 0, targetStock: 0, reason: 'Conteo' });
  assert.equal(aj.product.stock, 0);
  assert.equal(aj.product.status, 'Agotado');

  const after = await inv.loadAll(user);
  assert.equal(after.products.find((p) => p.id === nuevo.id).stock, 0);
  assert.equal(after.movements[0].type, 'Ajuste');
  assert.equal(after.movements[0].user, 'Gabriel Velasquez');
});

test('usuarios, configuración y permisos desde el cliente', skip, async () => {
  const admin = await inv.login('admin', PASS);
  const creado = await inv.saveUser({ name: 'María López', username: 'maria', role: 'Encargado', active: true, password: 'Maria12345' });
  assert.equal(creado.role, 'Encargado');
  await assert.rejects(inv.saveUser({ name: 'Otra', username: 'otra', role: 'Administrador', active: true, password: 'Otra123456' }), (e) => e.status === 403);
  await inv.saveUser({ ...creado, name: 'María L. Pérez' }); // editar sin tocar la contraseña
  const s = await inv.saveSettings({ businessName: 'Tienda Nueva', currency: 'GTQ', dateFormat: 'DD/MM/YYYY', defaultMinStock: '12', reportInfo: 'Info' });
  assert.equal(s.defaultMinStock, 12);

  // La nueva cuenta entra con su contraseña; como Encargado solo ve su propio usuario y no puede cambiar la configuración
  const maria = await inv.login('maria', 'Maria12345');
  const d = await inv.loadAll(maria);
  assert.deepEqual(d.users.map((u) => u.username), ['maria']);
  assert.equal(d.settings.businessName, 'Tienda Nueva');
  await assert.rejects(inv.saveSettings({ currency: 'USD' }), (e) => e.status === 403);
  assert.equal(admin.role, 'Administrador');
});

test('sesión: logout invalida el token y se avisa a la app; error de red legible', skip, async () => {
  await inv.login('encargado', PASS);
  const viejo = api.getToken();
  let avisos = 0;
  api.setUnauthorizedHandler(() => { avisos++; });
  await inv.logout();
  assert.equal(api.getToken(), null);
  api.setToken(viejo); // simula una pestaña con un token ya cerrado
  await assert.rejects(inv.me(), (e) => e.status === 401);
  assert.equal(avisos, 1, 'la app debe enterarse para llevar al login');
  api.setToken(null);

  await assert.rejects(inv.login('admin', 'incorrecta'), (e) => e.status === 401 && /incorrectos/.test(e.message));
  assert.equal(avisos, 1, 'un login fallido no debe contar como sesión expirada');

  globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));
  await assert.rejects(inv.login('admin', PASS), (e) => e.code === 'NETWORK_ERROR' && /backend/.test(e.message));
});
