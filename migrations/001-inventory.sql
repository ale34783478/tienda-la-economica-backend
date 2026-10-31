CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Superadministrador','Administrador','Encargado')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE TABLE IF NOT EXISTS products (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  date TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS products_code_lower ON products (lower(code));
CREATE TABLE IF NOT EXISTS movements (
  rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
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
CREATE TABLE IF NOT EXISTS revoked_tokens (jti TEXT PRIMARY KEY, exp BIGINT NOT NULL);
