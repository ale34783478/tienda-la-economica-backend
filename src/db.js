import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword } from './security.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Superadministrador','Administrador','Encargado')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('Entrada','Salida','Ajuste')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  reason TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  user_name TEXT NOT NULL,
  stock_before INTEGER,
  stock_after INTEGER
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON movements(date);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revoked_tokens (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  db.prepare('DELETE FROM revoked_tokens WHERE exp < ?').run(Math.floor(Date.now() / 1000));
  return db;
}

// Ejecuta fn dentro de una transacción; si lanza un error, revierte todo.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const DEFAULT_SETTINGS = {
  businessName: 'Tienda La Económica',
  currency: 'GTQ',
  dateFormat: 'DD/MM/YYYY',
  defaultMinStock: 10,
  reportInfo: 'Inventario y suministros generales',
};

// Datos iniciales (los mismos del modo demo del frontend). Solo se insertan si la base está vacía.
export function seedIfEmpty(db, seedPassword) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return null;

  const usedDefault = !seedPassword;
  const password = seedPassword || 'Economica2026!';
  const hash = hashPassword(password);

  tx(db, () => {
    const insUser = db.prepare('INSERT INTO users (id,name,username,password_hash,role,active) VALUES (?,?,?,?,?,1)');
    insUser.run('u1', 'Administrador General', 'superadmin', hash, 'Superadministrador');
    insUser.run('u2', 'Gabriel Velasquez', 'admin', hash, 'Administrador');
    insUser.run('u3', 'Danny Jose', 'encargado', hash, 'Encargado');

    const insProd = db.prepare('INSERT INTO products (id,code,name,description,category,price,stock,min_stock,active,date) VALUES (?,?,?,?,?,?,?,?,1,?)');
    const base = [
      ['p1', 'AB-101', 'Arroz Gallo Dorado 1 lb', 'Granos', 8.5, 34, 10, '2026-10-02'],
      ['p2', 'LT-220', 'Leche entera 1 L', 'Lácteos', 14, 6, 12, '2026-10-05'],
      ['p3', 'LB-330', 'Jabón en barra', 'Limpieza', 6.75, 0, 8, '2026-10-08'],
      ['p4', 'BC-440', 'Galletas de vainilla', 'Abarrotes', 5.5, 19, 8, '2026-10-10'],
    ];
    for (const [id, code, name, category, price, stock, min, date] of base) insProd.run(id, code, name, '', category, price, stock, min, date);

    const samples = ['Aceite vegetal 800 ml', 'Azúcar morena 1 lb', 'Atún en agua', 'Café molido 12 oz', 'Cereal de maíz', 'Detergente líquido', 'Escoba doméstica', 'Frijol negro 1 lb', 'Gaseosa naranja 2 L', 'Huevos docena', 'Jugo de naranja', 'Mantequilla 200 g', 'Papel higiénico 4 rollos', 'Pasta spaghetti', 'Sal yodada 500 g', 'Sopa instantánea', 'Toallas de cocina', 'Vinagre blanco'];
    const categories = ['Abarrotes', 'Bebidas', 'Limpieza', 'Granos', 'Lácteos', 'Hogar'];
    samples.forEach((name, i) => {
      insProd.run(`p${i + 5}`, `PR-${501 + i}`, name, '', categories[i % categories.length],
        +(4.5 + i * 1.35).toFixed(2), (i * 7 + 3) % 41, 8 + (i % 5), '2026-10-12');
    });

    db.prepare('INSERT INTO movements (id,product_id,type,quantity,reason,date,user_name,stock_before,stock_after) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('m1', 'p2', 'Entrada', 18, 'Recepción de proveedor', '2026-10-22T10:20:00.000Z', 'Gabriel Velasquez', null, null);

    const insSetting = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, JSON.stringify(v));
  });

  return { usedDefault, password };
}
