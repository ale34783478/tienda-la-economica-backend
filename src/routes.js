import { randomUUID, randomBytes } from 'node:crypto';
import { HttpError, Reply, Router, badRequest } from './http.js';
import { hashPassword, verifyPassword, signToken, LoginLimiter } from './security.js';
import { DEFAULT_SETTINGS } from './db.js';
import { validateProduct, validateMovement, validateUser, validateSettings } from './validate.js';

const ADMINS = ['Superadministrador', 'Administrador'];
const DUMMY_HASH = hashPassword('contraseña-ficticia'); // evita revelar por tiempo si un usuario existe

const statusOf = (stock, minStock) => (stock === 0 ? 'Agotado' : stock <= minStock ? 'Existencia baja' : 'Disponible');

const productOut = (r) => ({
  id: r.id, code: r.code, name: r.name, description: r.description, category: r.category,
  price: r.price, stock: r.stock, minStock: r.min_stock, active: !!r.active, date: r.date,
  status: statusOf(r.stock, r.min_stock),
});
const userOut = (r) => ({ id: r.id, name: r.name, username: r.username, role: r.role, active: !!r.active });
const movementOut = (r) => ({
  id: r.id, productId: r.product_id, productName: r.product_name ?? null, productCode: r.product_code ?? null,
  type: r.type, quantity: r.quantity, reason: r.reason, date: r.date, user: r.user_name,
  stockBefore: r.stock_before, stockAfter: r.stock_after,
});
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildRouter({ db, config }) {
  const r = new Router();
  const add = r.add.bind(r);
  r.add = (method, path, handler, opts) => add(method, path,
    method === 'GET' ? handler : (ctx) => db.transaction(() => handler(ctx)), opts);
  const limiter = new LoginLimiter();
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };

  const getProduct = async (id) => (await stmt('SELECT * FROM products WHERE id = ?' + db.lockClause).get(id));
  const getUser = async (id) => (await stmt('SELECT * FROM users WHERE id = ?' + db.lockClause).get(id));
  const notFound = (what, code) => new HttpError(404, `${what} no encontrado.`, code);

  async function insertMovement({ productId, type, quantity, reason, before, after, userName }) {
    const id = randomUUID();
    const date = new Date().toISOString();
    (await stmt('INSERT INTO movements (id,product_id,type,quantity,reason,date,user_name,stock_before,stock_after) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, productId, type, quantity, reason, date, userName, before, after));
    return id;
  }

  const movementById = async (id) => movementOut((await stmt(
    `SELECT m.*, p.name AS product_name, p.code AS product_code FROM movements m JOIN products p ON p.id = m.product_id WHERE m.id = ?`).get(id)));

  const getSettings = async () => {
    const out = { ...DEFAULT_SETTINGS };
    for (const row of (await stmt('SELECT key, value FROM settings').all())) out[row.key] = JSON.parse(row.value);
    return out;
  };

  const summary = async () => {
    const s = (await stmt(`SELECT COUNT(*) AS "activeProducts",
        COALESCE(SUM(stock),0) AS "totalUnits",
        COALESCE(SUM(stock*price),0) AS "inventoryValue",
        COALESCE(SUM(CASE WHEN stock=0 THEN 1 ELSE 0 END),0) AS "outOfStock",
        COALESCE(SUM(CASE WHEN stock>0 AND stock<=min_stock THEN 1 ELSE 0 END),0) AS "lowStock"
      FROM products WHERE active = 1`).get());
    const total = (await stmt('SELECT COUNT(*) AS n FROM products').get()).n;
    return { totalProducts: total, activeProducts: s.activeProducts, totalUnits: s.totalUnits,
      inventoryValue: round2(s.inventoryValue), lowStock: s.lowStock, outOfStock: s.outOfStock };
  };

  // ============ Salud ============
  r.add('GET', '/api/health', async () => {
    await stmt('SELECT 1 FROM users LIMIT 1').get();
    return { status: 'ok', database: db.dialect, time: new Date().toISOString() };
  }, { auth: false });

  // ============ Autenticación ============
  r.add('POST', '/api/auth/login', async ({ body, req }) => {
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) throw badRequest('Ingresa tus credenciales.');

    const key = `${req.socket.remoteAddress}|${username}`;
    if (limiter.blocked(key)) throw new HttpError(429, 'Demasiados intentos fallidos. Intenta de nuevo en unos minutos.', 'TOO_MANY_ATTEMPTS');

    const u = (await stmt('SELECT * FROM users WHERE lower(username) = lower(?)').get(username));
    const passwordOk = verifyPassword(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !u.active || !passwordOk) {
      limiter.fail(key);
      throw new HttpError(401, 'Usuario o contraseña incorrectos.', 'INVALID_CREDENTIALS');
    }
    limiter.reset(key);
    const token = signToken({ sub: u.id }, config.jwtSecret, config.tokenTtlSeconds);
    return { token, expiresIn: config.tokenTtlSeconds, user: userOut(u) };
  }, { auth: false });

  r.add('GET', '/api/auth/me', async ({ user }) => userOut(user));

  r.add('POST', '/api/auth/logout', async ({ auth }) => {
    (await stmt('INSERT INTO revoked_tokens (jti, exp) VALUES (?, ?) ON CONFLICT DO NOTHING').run(auth.jti, auth.exp));
    return null; // 204
  });

  // ============ Productos ============
  r.add('GET', '/api/products', async ({ query }) => {
    const where = [];
    const args = [];
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      where.push("(lower(name) LIKE lower(?) ESCAPE '\\' OR lower(code) LIKE lower(?) ESCAPE '\\' OR lower(category) LIKE lower(?) ESCAPE '\\')");
      args.push(like, like, like);
    }
    if (query.category) { where.push('lower(category) = lower(?)'); args.push(query.category); }
    if (query.active === 'true' || query.active === 'false') { where.push('active = ?'); args.push(query.active === 'true' ? 1 : 0); }
    if (query.status === 'Agotado') where.push('stock = 0');
    else if (query.status === 'Existencia baja') where.push('stock > 0 AND stock <= min_stock');
    else if (query.status === 'Disponible') where.push('stock > min_stock');
    const sql = `SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, rowid DESC`;
    return (await db.prepare(sql).all(...args)).map(productOut);
  });

  r.add('GET', '/api/products/:id', async ({ params }) => {
    const p = (await getProduct(params.id));
    if (!p) throw notFound('Producto', 'PRODUCT_NOT_FOUND');
    return productOut(p);
  });

  r.add('POST', '/api/products', async ({ body, user }) => {
    const p = validateProduct(body);
    const id = randomUUID();
    await db.transaction(async () => {
      if ((await stmt('SELECT 1 FROM products WHERE lower(code) = lower(?)').get(p.code))) {
        throw new HttpError(409, 'Este código ya está registrado.', 'CODE_DUPLICATE');
      }
      (await stmt('INSERT INTO products (id,code,name,description,category,price,stock,min_stock,active,date) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, p.code, p.name, p.description, p.category, p.price, p.stock, p.minStock, p.active ? 1 : 0, p.date || new Date().toISOString().slice(0, 10)));
      if (p.stock > 0) {
        (await insertMovement({ productId: id, type: 'Entrada', quantity: p.stock, reason: 'Existencia inicial', before: 0, after: p.stock, userName: user.name }));
      }
    });
    return new Reply(201, productOut((await getProduct(id))));
  });

  r.add('PUT', '/api/products/:id', async ({ params, body, user }) => {
    const current = (await getProduct(params.id));
    if (!current) throw notFound('Producto', 'PRODUCT_NOT_FOUND');
    // Los campos omitidos conservan su valor actual.
    const merged = { ...productOut(current), ...body };
    const p = validateProduct(merged);
    await db.transaction(async () => {
      const dup = (await stmt('SELECT id FROM products WHERE lower(code) = lower(?) AND id <> ?').get(p.code, params.id));
      if (dup) throw new HttpError(409, 'Este código ya está registrado.', 'CODE_DUPLICATE');
      (await stmt('UPDATE products SET code=?, name=?, description=?, category=?, price=?, stock=?, min_stock=?, active=?, date=? WHERE id=?')
        .run(p.code, p.name, p.description, p.category, p.price, p.stock, p.minStock, p.active ? 1 : 0, p.date || current.date, params.id));
      if (p.stock !== current.stock) { // si cambian las existencias, queda registro en el historial
        (await insertMovement({ productId: params.id, type: 'Ajuste', quantity: Math.abs(p.stock - current.stock),
          reason: 'Ajuste al editar el producto', before: current.stock, after: p.stock, userName: user.name }));
      }
    });
    return productOut((await getProduct(params.id)));
  });

  r.add('PATCH', '/api/products/:id/status', async ({ params, body }) => {
    if (typeof body.active !== 'boolean') throw badRequest('Envía "active" como verdadero o falso.', { active: 'Valor booleano requerido.' });
    const res = (await stmt('UPDATE products SET active = ? WHERE id = ?').run(body.active ? 1 : 0, params.id));
    if (!res.changes) throw notFound('Producto', 'PRODUCT_NOT_FOUND');
    return productOut((await getProduct(params.id)));
  });

  // ============ Inventario y movimientos ============
  r.add('GET', '/api/inventory', async () => ({
    summary: (await summary()),
    items: (await stmt('SELECT * FROM products WHERE active = 1 ORDER BY lower(name)').all()).map(productOut),
  }));

  r.add('GET', '/api/inventory/movements', async ({ query }) => {
    const where = [];
    const args = [];
    if (query.productId) { where.push('m.product_id = ?'); args.push(query.productId); }
    if (query.type) { where.push('m.type = ?'); args.push(query.type); }
    if (query.from) { where.push('substr(m.date,1,10) >= ?'); args.push(query.from); }
    if (query.to) { where.push('substr(m.date,1,10) <= ?'); args.push(query.to); }
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 500, 1), 1000);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const sql = `SELECT m.*, p.name AS product_name, p.code AS product_code
      FROM movements m JOIN products p ON p.id = m.product_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY m.date DESC, m.rowid DESC LIMIT ? OFFSET ?`;
    return (await db.prepare(sql).all(...args, limit, offset)).map(movementOut);
  });

  r.add('POST', '/api/inventory/movements', async ({ body, user }) => {
    const m = validateMovement(body);
    const id = await db.transaction(async () => {
      const p = (await getProduct(m.productId));
      if (!p) throw notFound('Producto', 'PRODUCT_NOT_FOUND');
      if (!p.active) throw new HttpError(409, 'El producto está inactivo.', 'PRODUCT_INACTIVE');

      let after;
      if (m.type === 'Entrada') after = p.stock + m.quantity;
      else if (m.type === 'Salida') {
        after = p.stock - m.quantity;
        if (after < 0) throw new HttpError(409, 'La salida supera las existencias disponibles.', 'INSUFFICIENT_STOCK', { available: p.stock, requested: m.quantity });
      } else {
        after = m.targetStock;
        if (after === p.stock) throw badRequest('La nueva existencia es igual a la actual.', { targetStock: 'No hay cambio que registrar.' });
      }
      if (after > 1e9) throw badRequest('La existencia resultante es demasiado grande.');

      (await stmt('UPDATE products SET stock = ? WHERE id = ?').run(after, p.id));
      return (await insertMovement({
        productId: p.id, type: m.type, quantity: m.type === 'Ajuste' ? Math.abs(after - p.stock) : m.quantity,
        reason: m.reason, before: p.stock, after, userName: user.name,
      }));
    });
    const movement = (await movementById(id));
    return new Reply(201, { ...movement, product: productOut((await getProduct(movement.productId))) });
  });

  // ============ Reportes ============
  r.add('GET', '/api/reports/inventory', async () => {
    const settings = (await getSettings());
    const byCategory = (await stmt(`SELECT category, COUNT(*) AS products, COALESCE(SUM(stock),0) AS units, COALESCE(SUM(stock*price),0) AS value
      FROM products WHERE active = 1 GROUP BY category ORDER BY lower(category)`).all())
      .map((c) => ({ category: c.category, products: c.products, units: c.units, value: round2(c.value) }));
    const rows = async (sql) => (await stmt(sql).all()).map(productOut);
    return {
      generatedAt: new Date().toISOString(),
      businessName: settings.businessName,
      reportInfo: settings.reportInfo,
      currency: settings.currency,
      summary: (await summary()),
      byCategory,
      lowStock: (await rows('SELECT * FROM products WHERE active = 1 AND stock > 0 AND stock <= min_stock ORDER BY stock, lower(name)')),
      outOfStock: (await rows('SELECT * FROM products WHERE active = 1 AND stock = 0 ORDER BY lower(name)')),
      items: (await rows('SELECT * FROM products WHERE active = 1 ORDER BY lower(name)')),
      recentMovements: (await stmt(`SELECT m.*, p.name AS product_name, p.code AS product_code
        FROM movements m JOIN products p ON p.id = m.product_id ORDER BY m.date DESC, m.rowid DESC LIMIT 20`).all()).map(movementOut),
    };
  });

  // ============ Usuarios ============
  // Superadministrador gestiona todas las cuentas; Administrador solo las de rol Encargado.
  const canManage = (actor, role) => actor.role === 'Superadministrador' || (actor.role === 'Administrador' && role === 'Encargado');
  const forbidden = () => new HttpError(403, 'No tienes permiso para administrar esta cuenta.', 'FORBIDDEN');
  const checkUsername = async (username, exceptId) => {
    const dup = (await stmt('SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?').get(username, exceptId ?? ''));
    if (dup) throw new HttpError(409, 'El usuario ya existe.', 'USERNAME_DUPLICATE');
  };

  r.add('GET', '/api/users', async () => (await stmt('SELECT * FROM users ORDER BY lower(name)').all()).map(userOut), { roles: ADMINS });

  r.add('POST', '/api/users', async ({ body, user }) => {
    const u = validateUser(body, { creating: true });
    if (!canManage(user, u.role)) throw forbidden();
    (await checkUsername(u.username));
    const temporaryPassword = u.password === undefined ? randomBytes(9).toString('base64url') : undefined;
    const id = randomUUID();
    (await stmt('INSERT INTO users (id,name,username,password_hash,role,active) VALUES (?,?,?,?,?,?)')
      .run(id, u.name, u.username, hashPassword(u.password ?? temporaryPassword), u.role, u.active ? 1 : 0));
    return new Reply(201, { ...userOut((await getUser(id))), ...(temporaryPassword && { temporaryPassword }) });
  }, { roles: ADMINS });

  r.add('PUT', '/api/users/:id', async ({ params, body, user }) => {
    const current = (await getUser(params.id));
    if (!current) throw notFound('Usuario', 'USER_NOT_FOUND');
    const isSelf = current.id === user.id;
    const u = validateUser({ ...userOut(current), ...body }, { creating: false });
    if (!(canManage(user, current.role) && canManage(user, u.role))) throw forbidden();
    if (isSelf && (u.role !== current.role || !u.active)) {
      throw new HttpError(403, 'No puedes cambiar tu propio rol ni desactivar tu cuenta.', 'FORBIDDEN');
    }
    (await checkUsername(u.username, current.id));
    (await stmt('UPDATE users SET name=?, username=?, role=?, active=?, password_hash=? WHERE id=?')
      .run(u.name, u.username, u.role, u.active ? 1 : 0, u.password ? hashPassword(u.password) : current.password_hash, current.id));
    return userOut((await getUser(current.id)));
  }, { roles: ADMINS });

  r.add('PATCH', '/api/users/:id/status', async ({ params, body, user }) => {
    const current = (await getUser(params.id));
    if (!current) throw notFound('Usuario', 'USER_NOT_FOUND');
    if (typeof body.active !== 'boolean') throw badRequest('Envía "active" como verdadero o falso.', { active: 'Valor booleano requerido.' });
    if (!canManage(user, current.role)) throw forbidden();
    if (current.id === user.id && !body.active) throw new HttpError(403, 'No puedes desactivar tu propia cuenta.', 'FORBIDDEN');
    (await stmt('UPDATE users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, current.id));
    return userOut((await getUser(current.id)));
  }, { roles: ADMINS });

  // ============ Configuración ============
  r.add('GET', '/api/settings', async () => (await getSettings()));
  r.add('PUT', '/api/settings', async ({ body }) => {
    const s = validateSettings(body);
    await db.transaction(async () => {
      for (const [k, v] of Object.entries(s)) (await stmt('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v)));
    });
    return (await getSettings());
  }, { roles: ADMINS });

  return r;
}
